import type { AudioSegment, AudiobookConfig } from './types';
import type { Segment } from './modes';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface AudioPart {
  audio: Buffer;
  pauseAfter: number;
}

export async function joinAudioWithPauses(parts: AudioPart[]): Promise<{ audio: Buffer; duration: number }> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2audiobook-'));
  try {
    const listLines: string[] = [];
    parts.forEach((part, i) => {
      const file = path.join(workDir, `part-${i}.mp3`);
      fs.writeFileSync(file, part.audio);
      listLines.push(`file '${file}'`);
      if (part.pauseAfter > 0 && i < parts.length - 1) {
        const silence = path.join(workDir, `pause-${i}.mp3`);
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
          '-t', String(part.pauseAfter), '-c:a', 'libmp3lame', '-q:a', '4', '-y', silence]);
        listLines.push(`file '${silence}'`);
      }
    });
    const listFile = path.join(workDir, 'list.txt');
    fs.writeFileSync(listFile, listLines.join('\n'));
    const outFile = path.join(workDir, 'joined.mp3');
    await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:a', 'libmp3lame', '-q:a', '4', '-y', outFile]);
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', outFile]);
    return { audio: fs.readFileSync(outFile), duration: parseFloat(stdout.trim()) };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export interface TTSProvider {
  synthesize(text: string, config: AudiobookConfig): Promise<Buffer>;
  getAvailableVoices(): Promise<string[]>;
  getName(): string;
}

export class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY is required. Get a free key at https://elevenlabs.io');
    }
  }

  getName(): string {
    return 'ElevenLabs Premium AI';
  }

  async synthesize(text: string, config: AudiobookConfig): Promise<Buffer> {
    const voices: { [key: string]: string } = {
      'sarah': 'EXAVITQu4vr4xnSDxMaL',     // Mature, Reassuring, Confident
      'bella': 'hpp4J3VqNfWAUOO0d1Us',     // Professional, Bright, Warm
      'laura': 'FGY2WhTYpPnrIDTdsKH5',     // Enthusiast, Quirky
      'charlie': 'IKne3meq5aSn9XLyUdCD',   // Deep, Confident, Energetic
      'george': 'JBFqnCBsd6RMkjVDRZzb',    // Warm, Captivating Storyteller
      'brian': 'nPczCjzI2devNBz1zQrb',     // Deep, Resonant and Comforting
    };

    const voiceId = voices[config.voice?.toLowerCase() || 'sarah'] || voices['sarah'];

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: 0.9,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text().catch(() => response.statusText);
        throw new Error(`ElevenLabs API error: ${error}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw new Error(`ElevenLabs synthesis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getAvailableVoices(): Promise<string[]> {
    return ['sarah', 'bella', 'laura', 'charlie', 'george'];
  }
}

export class TTSConverter {
  private provider: ElevenLabsTTS;

  constructor(config: AudiobookConfig) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ElevenLabs API key required.\n' +
        'Set: export ELEVENLABS_API_KEY="your_key"\n' +
        'Get free key: https://elevenlabs.io'
      );
    }
    this.provider = new ElevenLabsTTS(apiKey);
  }

  getProviderName(): string {
    return this.provider.getName();
  }

  async convertToAudio(text: string, config: AudiobookConfig): Promise<AudioSegment> {
    const maxChunkSize = 5000;
    const chunks = this.chunkText(text, maxChunkSize);

    const audioBuffers: Buffer[] = [];
    let totalDuration = 0;

    for (const chunk of chunks) {
      const audio = await this.provider.synthesize(chunk, config);
      audioBuffers.push(audio);
      totalDuration += chunk.length / 10;
    }

    return {
      text,
      audio: Buffer.concat(audioBuffers),
      duration: totalDuration,
      voice: config.voice,
    };
  }

  async convertSegmentsToAudio(segments: Segment[], config: AudiobookConfig): Promise<AudioSegment> {
    const parts: AudioPart[] = [];
    for (const segment of segments) {
      const chunks = this.chunkText(segment.text, 5000);
      for (let i = 0; i < chunks.length; i++) {
        const audio = await this.provider.synthesize(chunks[i], { ...config, voice: segment.voice });
        const last = i === chunks.length - 1;
        parts.push({ audio, pauseAfter: last ? segment.pauseAfter : 0 });
      }
    }
    const joined = await joinAudioWithPauses(parts);
    return {
      text: segments.map(s => s.text).join('\n\n'),
      audio: joined.audio,
      duration: joined.duration,
      voice: config.voice,
    };
  }

  async getAvailableVoices(): Promise<string[]> {
    return this.provider.getAvailableVoices();
  }

  private chunkText(text: string, maxSize: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }
}
