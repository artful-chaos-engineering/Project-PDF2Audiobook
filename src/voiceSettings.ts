// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import * as fs from 'fs';
import * as path from 'path';

export type TextNormalization = 'auto' | 'on' | 'off';
export const TEXT_NORMALIZATION_VALUES: TextNormalization[] = ['auto', 'on', 'off'];

export interface VoiceTuning {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
  // Level change applied to this voice after the levelling step, in dB.
  trim_db: number;
  // Multiplier on the pauses that follow this voice's speech.
  pause_scale: number;
  // How closely a professional voice clone is applied (eleven_v4 only).
  clone_strength: number;
  text_normalization: TextNormalization;
  // Same seed and settings give the same result, best effort. null means random.
  seed: number | null;
}

export const DEFAULT_TUNING: VoiceTuning = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  speed: 1.0,
  use_speaker_boost: true,
  trim_db: 0,
  pause_scale: 1,
  clone_strength: 0,
  text_normalization: 'auto',
  seed: null,
};

// Ranges from the ElevenLabs documentation: speed is documented as 0.7 to 1.2.
type NumericKey = 'stability' | 'similarity_boost' | 'style' | 'speed' | 'trim_db' | 'pause_scale' | 'clone_strength';
export const TUNING_RANGES: Record<NumericKey, [number, number]> = {
  stability: [0, 1],
  similarity_boost: [0, 1],
  style: [0, 1],
  speed: [0.7, 1.2],
  trim_db: [-6, 6],
  pause_scale: [0.5, 2],
  clone_strength: [0, 1],
};

export const TUNING_FILE = path.join(process.cwd(), 'voices.json');

export function validateTuning(input: unknown): VoiceTuning {
  if (typeof input !== 'object' || input === null) throw new Error('Voice settings must be an object.');
  const source = { ...DEFAULT_TUNING, ...(input as Record<string, unknown>) } as Record<string, unknown>;
  const result: VoiceTuning = { ...DEFAULT_TUNING };
  for (const key of Object.keys(TUNING_RANGES) as NumericKey[]) {
    const value = source[key];
    const [min, max] = TUNING_RANGES[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${key} must be a number from ${min} to ${max}.`);
    }
    result[key] = Math.round(value * 1000) / 1000;
  }
  if (typeof source.use_speaker_boost !== 'boolean') throw new Error('use_speaker_boost must be true or false.');
  result.use_speaker_boost = source.use_speaker_boost;
  if (!TEXT_NORMALIZATION_VALUES.includes(source.text_normalization as TextNormalization)) {
    throw new Error(`text_normalization must be one of: ${TEXT_NORMALIZATION_VALUES.join(', ')}.`);
  }
  result.text_normalization = source.text_normalization as TextNormalization;
  if (source.seed !== null) {
    if (typeof source.seed !== 'number' || !Number.isInteger(source.seed) || source.seed < 0 || source.seed > 4294967295) {
      throw new Error('seed must be empty or a whole number from 0 to 4294967295.');
    }
  }
  result.seed = source.seed as number | null;
  return result;
}

export function readTunings(): Record<string, VoiceTuning> {
  if (!fs.existsSync(TUNING_FILE)) return {};
  const data = JSON.parse(fs.readFileSync(TUNING_FILE, 'utf-8')) as Record<string, unknown>;
  const out: Record<string, VoiceTuning> = {};
  for (const [voice, value] of Object.entries(data)) {
    try {
      out[voice] = validateTuning(value);
    } catch (err) {
      throw new Error(`${TUNING_FILE}: ${voice}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

export function tuningOf(voice: string, tunings: Record<string, VoiceTuning> = readTunings()): VoiceTuning {
  return tunings[voice] ?? DEFAULT_TUNING;
}

export function writeTuning(voice: string, tuning: VoiceTuning): void {
  const all = readTunings();
  all[voice] = validateTuning(tuning);
  const tmp = `${TUNING_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  fs.renameSync(tmp, TUNING_FILE);
}

export function sameTuning(a: VoiceTuning, b: VoiceTuning): boolean {
  return (Object.keys(DEFAULT_TUNING) as (keyof VoiceTuning)[]).every(key => a[key] === b[key]);
}
