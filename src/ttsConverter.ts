// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import type { AudioSegment, AudiobookConfig } from './types';
import type { Segment } from './modes';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Writable } from 'stream';
import { DEFAULT_TUNING, VoiceTuning, readTunings, sameTuning, tuningOf } from './voiceSettings';
import { activeLocators } from './pronunciation';
import { synthesizeHeyGen } from './heygen';
import { voiceServerId } from './voiceServer';

const API = 'https://api.elevenlabs.io/v1';
const OUTPUT_FORMAT = 'mp3_44100_192';
const SAMPLE_RATE = 44100;
const TARGET_LUFS = -18;
const MAX_GAIN_DB = 12;
const PEAK_CEILING_DB = -1;
const MAX_TTS_CHARS = 4500;
const CONTEXT_CHARS = 300;
const SENTENCE_GAP_SECONDS = 0.2;

export const DEFAULT_TTS_MODEL = 'eleven_v4';
export const MAX_DIALOGUE_CHARS = 1800;

const DIALOGUE_MODELS = new Set(['eleven_v4', 'eleven_v3']);
// These models take no speed or style control, so only the stability, similarity and speaker-boost settings are sent.
const STORED_SETTINGS_MODELS = new Set(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3', 'eleven_v3_conversational']);

export function voiceSettingsFor(model: string, tuning: VoiceTuning): Record<string, number | boolean> {
  const base: Record<string, number | boolean> = {
    stability: tuning.stability,
    similarity_boost: tuning.similarity_boost,
    use_speaker_boost: tuning.use_speaker_boost,
  };
  if (model === 'eleven_v4') base.clone_strength = tuning.clone_strength;
  return STORED_SETTINGS_MODELS.has(model) ? base : { ...base, style: tuning.style, speed: tuning.speed };
}

// Models that interpret bracketed delivery tags. On any other model the tags would be read aloud, so they are removed.
const AUDIO_TAG_MODELS = new Set(['eleven_v4', 'eleven_v3']);
const AUDIO_TAG = /\[[A-Za-z][A-Za-z ]{0,30}\]\s*/g;

export function audioTagsEnabled(model: string = ttsModel()): boolean {
  return AUDIO_TAG_MODELS.has(model) && (process.env.AUDIO_TAGS || 'off').toLowerCase() === 'on';
}

export function prepareSpeech(text: string, model: string = ttsModel()): string {
  if (AUDIO_TAG_MODELS.has(model) && audioTagsEnabled(model)) return text;
  return text.replace(AUDIO_TAG, '').replace(/\s{2,}/g, ' ').trim();
}

function requestExtras(tuning: VoiceTuning): Record<string, unknown> {
  const extras: Record<string, unknown> = { apply_text_normalization: tuning.text_normalization };
  if (tuning.seed !== null) extras.seed = tuning.seed;
  const locators = activeLocators();
  if (locators.length > 0) extras.pronunciation_dictionary_locators = locators;
  return extras;
}

export function ttsModel(): string {
  return process.env.TTS_MODEL || DEFAULT_TTS_MODEL;
}

export function usesDialogueApi(model: string = ttsModel()): boolean {
  return DIALOGUE_MODELS.has(model) && (process.env.TTS_DIALOGUE || 'on').toLowerCase() !== 'off';
}

// True when every voice in the exchange has the same settings, so one take can carry them all.
export function takeCanBeOneRequest(voices: string[], tunings: Record<string, VoiceTuning>): boolean {
  const unique = [...new Set(voices)];
  return unique.every(v => sameTuning(tuningOf(v, tunings), tuningOf(unique[0], tunings)));
}

export interface AudioRegion {
  group: string;
  start: number;
  end: number;
  trimDb?: number;
}

export interface AudioPart {
  audio: Buffer;
  pauseAfter: number;
  // Who speaks when, in seconds from the start of the clip. One region covers a single-voice clip.
  // A group is a voice from one kind of request; each group is levelled separately, because the
  // same voice comes back at a different loudness from the dialogue and single-voice endpoints.
  regions: AudioRegion[];
}

export interface DialogueLine {
  voice: string;
  text: string;
  pauseAfter: number;
}

function splitLong(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (current && current.length + 1 + word.length > maxSize) {
      pieces.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkText(text: string, maxSize: number): string[] {
  // Split only where a sentence end is followed by a space, so decimals such as "2.5" stay whole
  // and text after the last full stop is never lost.
  const sentences = text.trim().split(/(?<=[.!?]["')\]]*)\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences.flatMap(s => splitLong(s, maxSize))) {
    if (current && current.length + 1 + sentence.length > maxSize) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function batchDialogue(lines: DialogueLine[], maxChars: number = MAX_DIALOGUE_CHARS): DialogueLine[][] {
  const batches: DialogueLine[][] = [];
  let current: DialogueLine[] = [];
  let size = 0;
  for (const line of lines) {
    const pieces = chunkText(line.text, maxChars);
    pieces.forEach((text, i) => {
      if (current.length > 0 && size + text.length > maxChars) {
        batches.push(current);
        current = [];
        size = 0;
      }
      const pauseAfter = i === pieces.length - 1 ? line.pauseAfter : SENTENCE_GAP_SECONDS;
      current.push({ voice: line.voice, text, pauseAfter });
      size += text.length;
    });
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function write(stream: Writable, chunk: Buffer): Promise<void> {
  return new Promise(resolve => {
    if (stream.destroyed || stream.write(chunk)) {
      resolve();
      return;
    }
    const done = () => {
      stream.off('drain', done);
      stream.off('close', done);
      resolve();
    };
    stream.once('drain', done);
    stream.once('close', done);
  });
}

function runFfmpeg(args: string[], feed?: (stdin: Writable) => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-nostats', ...args], { stdio: [feed ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
    child.on('error', err => reject(new Error(`ffmpeg could not start: ${err.message}. Install it (brew install ffmpeg).`)));
    child.on('close', code => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg failed (exit ${code}): ${stderr.slice(-600)}`));
    });
    if (feed && child.stdin) {
      const stdin = child.stdin;
      // ffmpeg can exit before it has read everything; its exit code reports that failure.
      stdin.on('error', () => {});
      feed(stdin).then(() => stdin.end(), err => {
        stdin.destroy();
        reject(err);
      });
    }
  });
}

const PCM_FORMAT = ['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1'];
const SILENCE_AMPLITUDE = Math.round(32768 * Math.pow(10, -50 / 20));
const EDGE_KEEP_SAMPLES = Math.round(0.03 * SAMPLE_RATE);
const RAMP_SAMPLES = Math.round(0.02 * SAMPLE_RATE);
const MAX_INNER_PAUSE_SAMPLES = Math.round(0.55 * SAMPLE_RATE);

interface Span {
  group: string;
  from: number;
  to: number;
}

function toSamples(pcm: Buffer): Int16Array {
  const bytes = pcm.length - (pcm.length % 2);
  return new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + bytes));
}

function speechBounds(samples: Int16Array): { from: number; to: number } {
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) <= SILENCE_AMPLITUDE) first++;
  if (first === samples.length) return { from: 0, to: 0 };
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) <= SILENCE_AMPLITUDE) last--;
  return {
    from: Math.max(0, first - EDGE_KEEP_SAMPLES),
    to: Math.min(samples.length, last + 1 + EDGE_KEEP_SAMPLES),
  };
}

// The spans cover the clip from its first to its last sound with no gaps, so splitting by voice drops nothing.
export function spansOf(regions: AudioRegion[], samples: Int16Array): Span[] {
  const { from, to } = speechBounds(samples);
  const spans: Span[] = [];
  let cursor = from;
  regions.forEach((region, i) => {
    const wanted = i === regions.length - 1 ? to : Math.round(region.end * SAMPLE_RATE);
    const end = Math.max(cursor, Math.min(to, wanted));
    if (end > cursor) spans.push({ group: region.group, from: cursor, to: end });
    cursor = end;
  });
  return spans;
}

export function applyGains(samples: Int16Array, spans: Span[], gains: Map<string, number>): void {
  const factors = spans.map(span => Math.pow(10, (gains.get(span.group) ?? 0) / 20));
  const half = Math.floor(RAMP_SAMPLES / 2);
  spans.forEach((span, k) => {
    for (let i = span.from; i < span.to; i++) {
      let factor = factors[k];
      // Ramp between two voices' gains over 20 ms so the change of level cannot click.
      if (k > 0 && i - span.from < half) {
        factor = factors[k - 1] + (factors[k] - factors[k - 1]) * ((i - span.from + half) / RAMP_SAMPLES);
      } else if (k < spans.length - 1 && span.to - i <= half) {
        factor = factors[k] + (factors[k + 1] - factors[k]) * ((half - (span.to - i)) / RAMP_SAMPLES);
      }
      samples[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * factor)));
    }
  });
}

// The speech model sometimes leaves a long silence inside a clip. Each silent stretch longer than
// the limit is cut down to the limit by removing its middle, so no speech is touched.
export function keptRanges(samples: Int16Array, from: number, to: number, maxPause: number = MAX_INNER_PAUSE_SAMPLES): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  let start = from;
  let runStart = -1;
  for (let i = from; i <= to; i++) {
    const silent = i < to && Math.abs(samples[i]) <= SILENCE_AMPLITUDE;
    if (silent) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0 && i - runStart > maxPause) {
      const keepHead = Math.ceil(maxPause / 2);
      const keepTail = maxPause - keepHead;
      ranges.push({ from: start, to: runStart + keepHead });
      start = i - keepTail;
    }
    runStart = -1;
  }
  if (to > start) ranges.push({ from: start, to });
  return ranges;
}

function sliceBuffer(samples: Int16Array, from: number, to: number): Buffer {
  return Buffer.from(samples.buffer, samples.byteOffset + from * 2, (to - from) * 2);
}

async function measureGroup(group: string, files: string[], parts: AudioPart[]): Promise<{ loudness: number | null; peakDb: number }> {
  let peak = 0;
  const stderr = await runFfmpeg([...PCM_FORMAT, '-i', 'pipe:0', '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], async stdin => {
    for (const [i, file] of files.entries()) {
      if (!parts[i].regions.some(region => region.group === group)) continue;
      const samples = toSamples(fs.readFileSync(file));
      for (const span of spansOf(parts[i].regions, samples)) {
        if (span.group !== group) continue;
        for (let n = span.from; n < span.to; n++) {
          const value = Math.abs(samples[n]);
          if (value > peak) peak = value;
        }
        await write(stdin, sliceBuffer(samples, span.from, span.to));
      }
    }
  });
  const readings = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)];
  const loudness = readings.length > 0 ? parseFloat(readings[readings.length - 1][1]) : NaN;
  return {
    // ebur128 reports -70 LUFS when there is too little audio to measure.
    loudness: Number.isFinite(loudness) && loudness > -60 ? loudness : null,
    peakDb: peak > 0 ? 20 * Math.log10(peak / 32768) : -Infinity,
  };
}

// Every voice is brought to one common loudness. That level is the target, or lower when a voice
// has too little headroom to reach the target without clipping.
export function matchingGains(measured: Map<string, { loudness: number; peakDb: number }>): Map<string, number> {
  let level = TARGET_LUFS;
  for (const { loudness, peakDb } of measured.values()) {
    level = Math.min(level, loudness + (PEAK_CEILING_DB - peakDb));
  }
  const gains = new Map<string, number>();
  for (const [group, { loudness }] of measured) {
    gains.set(group, Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, level - loudness)));
  }
  return gains;
}

export async function assembleAudio(parts: AudioPart[]): Promise<{ audio: Buffer; duration: number }> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2audiobook-'));
  try {
    const files: string[] = [];
    for (const [i, part] of parts.entries()) {
      const source = path.join(workDir, `part-${i}.mp3`);
      const pcm = path.join(workDir, `part-${i}.pcm`);
      fs.writeFileSync(source, part.audio);
      await runFfmpeg(['-v', 'error', '-i', source, ...PCM_FORMAT, '-y', pcm]);
      fs.rmSync(source);
      files.push(pcm);
    }

    const measured = new Map<string, { loudness: number; peakDb: number }>();
    for (const group of new Set(parts.flatMap(part => part.regions.map(region => region.group)))) {
      const { loudness, peakDb } = await measureGroup(group, files, parts);
      if (loudness !== null) measured.set(group, { loudness, peakDb });
    }
    const gains = matchingGains(measured);
    // A voice's trim is added to its levelled gain, but never past the point where its loudest sample would clip.
    const trims = new Map<string, number>();
    for (const part of parts) for (const region of part.regions) trims.set(region.group, region.trimDb ?? 0);
    for (const [group, gain] of [...gains]) {
      const peakDb = measured.get(group)?.peakDb ?? 0;
      gains.set(group, Math.min(gain + (trims.get(group) ?? 0), PEAK_CEILING_DB - peakDb));
    }

    const outFile = path.join(workDir, 'joined.mp3');
    let total = 0;
    await runFfmpeg(['-v', 'error', ...PCM_FORMAT, '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-y', outFile], async stdin => {
      for (const [i, part] of parts.entries()) {
        const samples = toSamples(fs.readFileSync(files[i]));
        const spans = spansOf(part.regions, samples);
        if (spans.length > 0) {
          applyGains(samples, spans, gains);
          for (const range of keptRanges(samples, spans[0].from, spans[spans.length - 1].to)) {
            await write(stdin, sliceBuffer(samples, range.from, range.to));
            total += range.to - range.from;
          }
        }
        if (i < parts.length - 1 && part.pauseAfter > 0) {
          const silence = Buffer.alloc(Math.round(part.pauseAfter * SAMPLE_RATE) * 2);
          await write(stdin, silence);
          total += silence.length / 2;
        }
      }
    });
    return { audio: fs.readFileSync(outFile), duration: total / SAMPLE_RATE };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export interface TTSProvider {
  synthesize(text: string, config: AudiobookConfig): Promise<Buffer>;
  getAvailableVoices(): Promise<string[]>;
  getName(): string;
}

export const VOICE_IDS: Record<string, string> = {
  'sarah': 'EXAVITQu4vr4xnSDxMaL',
  'bella': 'hpp4J3VqNfWAUOO0d1Us',
  'jessica': 'cgSgspJ2msm6clMCkdW9',
  'laura': 'FGY2WhTYpPnrIDTdsKH5',
  'matilda': 'XrExE9yKIg1WjnnlVkGX',
  'adam': 'pNInz6obpgDQGcFmaJgB',
  'bill': 'pqHfZKP75CvOlQylNhV4',
  'brian': 'nPczCjzI2devNBz1zQrb',
  'callum': 'N2lVS1w4EtoT3dr4eOWO',
  'chris': 'iP95p4xoKVk53GoZ742B',
  'dr_odom': 'gPiEpcKoaZywgOzc0Zn9',
  'eric': 'cjVigY5qzO86Huf0OWal',
  'harry': 'SOYHLrjzK2X1ezoPC6cr',
  'liam': 'TX3LPaxmHKxFdv7VOQHJ',
  'roger': 'CwhRBWXzGAHq8TQ4Fs17',
  'will': 'bIHbv24MWmeRgasZH58o',
  'mark': 't7vGufKA3Lw1xOV7h1bv',
  'charlie': 'IKne3meq5aSn9XLyUdCD',
  'george': 'JBFqnCBsd6RMkjVDRZzb',
};

function voiceIdOf(name: string | undefined): string {
  const voiceId = VOICE_IDS[(name || '').toLowerCase()];
  if (!voiceId) throw new Error(`Unknown voice "${name}". Use one of: ${Object.keys(VOICE_IDS).join(', ')}`);
  return voiceId;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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

  private async request(endpoint: string, body: Record<string, unknown>): Promise<Response> {
    const retryDelays = [2000, 8000];
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${API}${endpoint}?output_format=${OUTPUT_FORMAT}`, {
          method: 'POST',
          headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (attempt < retryDelays.length) {
          await sleep(retryDelays[attempt]);
          continue;
        }
        throw new Error(`ElevenLabs request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (response.ok) return response;
      const detail = await response.text().catch(() => response.statusText);
      if ((response.status === 429 || response.status >= 500) && attempt < retryDelays.length) {
        await sleep(retryDelays[attempt]);
        continue;
      }
      throw new Error(`ElevenLabs API error (${response.status}): ${detail}`);
    }
  }

  async synthesize(text: string, config: AudiobookConfig, context: { previous?: string; next?: string; tuning?: VoiceTuning } = {}): Promise<Buffer> {
    const model = ttsModel();
    const tuning = context.tuning ?? DEFAULT_TUNING;
    const body: Record<string, unknown> = { text: prepareSpeech(text, model), model_id: model, ...requestExtras(tuning) };
    if (context.previous) body.previous_text = prepareSpeech(context.previous, model);
    if (context.next) body.next_text = prepareSpeech(context.next, model);
    body.voice_settings = voiceSettingsFor(model, tuning);
    const response = await this.request(`/text-to-speech/${voiceIdOf(config.voice)}`, body);
    return Buffer.from(await response.arrayBuffer());
  }

  async synthesizeDialogue(lines: DialogueLine[], previousRequestIds: string[], tuning: VoiceTuning): Promise<{ audio: Buffer; requestId: string | null; regions: AudioRegion[] }> {
    const body: Record<string, unknown> = {
      model_id: ttsModel(),
      inputs: lines.map(line => ({ text: prepareSpeech(line.text), voice_id: voiceIdOf(line.voice) })),
      settings: {
        stability: tuning.stability,
        similarity: tuning.similarity_boost,
        ...(ttsModel() === 'eleven_v4' ? { clone_strength: tuning.clone_strength } : {}),
      },
      ...requestExtras(tuning),
    };
    if (previousRequestIds.length > 0) body.previous_request_ids = previousRequestIds;
    const response = await this.request('/text-to-dialogue/with-timestamps', body);
    const data = await response.json() as {
      audio_base64?: string;
      voice_segments?: { start_time_seconds: number; end_time_seconds: number; dialogue_input_index: number }[];
    };
    if (!data.audio_base64) throw new Error('ElevenLabs dialogue response had no audio');
    const regions = (data.voice_segments ?? [])
      .filter(segment => lines[segment.dialogue_input_index] !== undefined)
      .map(segment => ({
        group: `${lines[segment.dialogue_input_index].voice}/dialogue`,
        start: segment.start_time_seconds,
        end: segment.end_time_seconds,
      }));
    // Without timing from the API the take cannot be split by voice, so it is levelled as one unit.
    const fallback = [{ group: 'dialogue', start: 0, end: Number.MAX_SAFE_INTEGER }];
    return {
      audio: Buffer.from(data.audio_base64, 'base64'),
      requestId: response.headers.get('request-id'),
      regions: regions.length > 0 ? regions : fallback,
    };
  }

  async getAvailableVoices(): Promise<string[]> {
    return Object.keys(VOICE_IDS);
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
    const chunks = chunkText(text, MAX_TTS_CHARS);

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

  // HeyGen speaks one piece of text at a time: it has no dialogue takes, no context text and no
  // per-voice tuning, so each segment is rendered on its own and only the pauses and levelling apply.
  private async convertWithHeyGen(segments: Segment[], config: AudiobookConfig): Promise<AudioSegment> {
    const parts: AudioPart[] = [];
    for (const segment of segments) {
      const chunks = chunkText(segment.text, 9000);
      for (const [c, chunk] of chunks.entries()) {
        const audio = await synthesizeHeyGen(chunk, segment.voice);
        const last = c === chunks.length - 1;
        parts.push({
          audio,
          regions: [{ group: `${segment.voice}/heygen`, start: 0, end: Number.MAX_SAFE_INTEGER, trimDb: 0 }],
          pauseAfter: last ? segment.pauseAfter : SENTENCE_GAP_SECONDS,
        });
      }
    }
    const joined = await assembleAudio(parts);
    return {
      text: segments.map(s => s.text).join('\n\n'),
      audio: joined.audio,
      duration: joined.duration,
      voice: config.voice,
    };
  }

  async convertSegmentsToAudio(segments: Segment[], config: AudiobookConfig): Promise<AudioSegment> {
    if (voiceServerId() === 'heygen') return this.convertWithHeyGen(segments, config);
    const parts: AudioPart[] = [];
    const dialogue = usesDialogueApi();
    const tunings = readTunings();
    let requestIds: string[] = [];

    // A two-voice exchange is one take only when both voices share their settings: the take has one
    // set of settings for the whole exchange. Otherwise each line is rendered with its own voice's settings.
    const takeIsUniform = (from: number, to: number): boolean => takeCanBeOneRequest(segments.slice(from, to).map(s => s.voice), tunings);

    let i = 0;
    while (i < segments.length) {
      const segment = segments[i];

      let end = i;
      while (end < segments.length && segments[end].group === segment.group) end++;

      if (dialogue && segment.group !== undefined && takeIsUniform(i, end)) {
        const lines = segments.slice(i, end).map(s => ({ voice: s.voice, text: s.text, pauseAfter: s.pauseAfter }));
        const tuning = tuningOf(lines[0].voice, tunings);
        for (const batch of batchDialogue(lines)) {
          const { audio, requestId, regions } = await this.provider.synthesizeDialogue(batch, requestIds, tuning);
          if (requestId) requestIds = [...requestIds, requestId].slice(-3);
          const lastVoice = batch[batch.length - 1].voice;
          const withTrim = regions.map(r => ({
            ...r,
            trimDb: tuningOf(r.group.includes('/') ? r.group.split('/')[0] : lastVoice, tunings).trim_db,
          }));
          parts.push({ audio, regions: withTrim, pauseAfter: batch[batch.length - 1].pauseAfter * tuningOf(lastVoice, tunings).pause_scale });
        }
        i = end;
        continue;
      }

      const chunks = chunkText(segment.text, MAX_TTS_CHARS);
      for (const [c, chunk] of chunks.entries()) {
        const previous = c > 0 ? chunks[c - 1] : segments[i - 1]?.text;
        const next = c < chunks.length - 1 ? chunks[c + 1] : segments[i + 1]?.text;
        const audio = await this.provider.synthesize(chunk, { ...config, voice: segment.voice }, {
          previous: previous?.slice(-CONTEXT_CHARS),
          next: next?.slice(0, CONTEXT_CHARS),
          tuning: tuningOf(segment.voice, tunings),
        });
        const last = c === chunks.length - 1;
        const own = tuningOf(segment.voice, tunings);
        const regions = [{ group: `${segment.voice}/single`, start: 0, end: Number.MAX_SAFE_INTEGER, trimDb: own.trim_db }];
        parts.push({ audio, regions, pauseAfter: last ? segment.pauseAfter * own.pause_scale : SENTENCE_GAP_SECONDS });
      }
      i++;
    }

    const joined = await assembleAudio(parts);
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
}
