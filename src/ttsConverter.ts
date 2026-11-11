import type { AudioSegment, AudiobookConfig } from './types';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface TTSProvider {
  synthesize(text: string, config: AudiobookConfig): Promise<Buffer>;
  getAvailableVoices(): Promise<string[]>;
}

export class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ElevenLabs API key not found. Set ELEVENLABS_API_KEY environment variable.');
    }
  }

  async synthesize(text: string, config: AudiobookConfig): Promise<Buffer> {
    const voice = config.voice || 'bella';
    const voiceId = this.getVoiceId(voice);

    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          language_code: config.language || 'en-US',
        }),
      });

      if (!response.ok) {
        const errorData = await response.text().catch(() => '');
        if (response.status === 401) {
          throw new Error('ElevenLabs API key is invalid. Check ELEVENLABS_API_KEY environment variable.');
        } else if (response.status === 429) {
          throw new Error('ElevenLabs API rate limit exceeded. Try again later.');
        } else if (response.status === 400) {
          throw new Error(`ElevenLabs API error: ${errorData || response.statusText}`);
        }
        throw new Error(`ElevenLabs API error: ${response.statusText}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error('Network error: Cannot connect to ElevenLabs API. Check your internet connection.');
      }
      throw error;
    }
  }

  async getAvailableVoices(): Promise<string[]> {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`);
    }

    const data = await response.json() as { voices: Array<{ voice_id: string; name: string }> };
    return data.voices.map(v => v.name);
  }

  private getVoiceId(voiceName: string): string {
    const voiceMap: { [key: string]: string } = {
      bella: '21m00Tcm4TlvDq8ikWAM',
      rachel: '21m00Tcm4TlvDq8ikWAM',
      domi: '21m00Tcm4TlvDq8ikWAM',
      antoni: '21m00Tcm4TlvDq8ikWAM',
    };
    return voiceMap[voiceName.toLowerCase()] || '21m00Tcm4TlvDq8ikWAM';
  }
}

export class GoogleTTS implements TTSProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('Google API key not found. Set GOOGLE_API_KEY environment variable.');
    }
  }

  async synthesize(text: string, config: AudiobookConfig): Promise<Buffer> {
    try {
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { text },
            voice: {
              languageCode: config.language || 'en-US',
              name: config.voice || 'en-US-Neural2-A',
            },
            audioConfig: {
              audioEncoding: 'MP3',
              speakingRate: config.speed || 1.0,
            },
          }),
        }
      );

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Google API key is invalid. Check GOOGLE_API_KEY environment variable.');
        } else if (response.status === 429) {
          throw new Error('Google API rate limit exceeded. Try again later.');
        }
        throw new Error(`Google TTS API error: ${response.statusText}`);
      }

      const data = await response.json() as { audioContent: string };
      return Buffer.from(data.audioContent, 'base64');
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error('Network error: Cannot connect to Google TTS API. Check your internet connection.');
      }
      throw error;
    }
  }

  async getAvailableVoices(): Promise<string[]> {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?key=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.statusText}`);
    }

    const data = await response.json() as { voices: Array<{ name: string }> };
    return data.voices.map(v => v.name);
  }
}

export class MacTTS implements TTSProvider {
  private voiceName: string = 'Samantha';

  constructor(voiceName?: string) {
    this.voiceName = voiceName || 'Samantha';
  }

  async synthesize(text: string, config: AudiobookConfig): Promise<Buffer> {
    const tmpDir = os.tmpdir();
    const textFile = path.join(tmpDir, `text-${Date.now()}.txt`);
    const audioFile = path.join(tmpDir, `audio-${Date.now()}.aiff`);
    const rate = config.speed ? Math.round(200 * config.speed) : 200;

    try {
      // Write text to file to avoid command-line escaping issues
      fs.writeFileSync(textFile, text);

      // Use system 'say' command to generate audio from file (AIFF is native to macOS)
      await execAsync(`say -v "${this.voiceName}" -r ${rate} -f "${textFile}" -o "${audioFile}"`);

      // Read the generated audio file
      const audioBuffer = fs.readFileSync(audioFile);

      // Clean up temp files
      fs.unlinkSync(textFile);
      fs.unlinkSync(audioFile);

      return audioBuffer;
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(textFile)) fs.unlinkSync(textFile);
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      throw new Error(`TTS generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getAvailableVoices(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('say -v ?');
      return stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.split(/\s+/)[0])
        .filter(v => v.length > 0);
    } catch {
      return ['Samantha', 'Victoria', 'Alex'];
    }
  }
}

export class TTSConverter {
  private provider: TTSProvider;

  constructor(config: AudiobookConfig) {
    this.provider = this.getProvider(config.voiceProvider, config);
  }

  async convertToAudio(text: string, config: AudiobookConfig): Promise<AudioSegment> {
    // Split text into chunks (avoid hitting token limits)
    const maxChunkSize = 5000;
    const chunks = this.chunkText(text, maxChunkSize);

    const audioBuffers: Buffer[] = [];
    let totalDuration = 0;

    for (const chunk of chunks) {
      const audio = await this.provider.synthesize(chunk, config);
      audioBuffers.push(audio);
      // Rough estimate: ~150 words per minute in speech = ~10 chars per second
      totalDuration += chunk.length / 10;
    }

    return {
      text,
      audio: Buffer.concat(audioBuffers),
      duration: totalDuration,
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
      if ((currentChunk + sentence).length > maxSize) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  private getProvider(providerName: string, config: AudiobookConfig): TTSProvider {
    switch (providerName) {
      case 'elevenlabs':
        try {
          return new ElevenLabsTTS();
        } catch {
          console.warn('⚠️ ElevenLabs API key not found, falling back to system TTS');
          return new MacTTS(config.voice);
        }
      case 'google':
        try {
          return new GoogleTTS();
        } catch {
          console.warn('⚠️ Google API key not found, falling back to system TTS');
          return new MacTTS(config.voice);
        }
      case 'mac':
        return new MacTTS(config.voice);
      default:
        // Default to Mac TTS (works without API keys)
        return new MacTTS(config.voice);
    }
  }
}
