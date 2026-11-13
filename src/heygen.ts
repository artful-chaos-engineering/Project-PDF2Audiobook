// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

const API = 'https://api.heygen.com';
const RETRY_DELAYS = [2000, 8000, 20000];
export const HEYGEN_MODEL = 'heygen-voice-1';

export interface HeyGenVoice {
  id: string;
  name: string;
  gender: string | null;
  language: string | null;
}

export function heygenKey(): string {
  return (process.env.HEYGEN_API_KEY ?? '').trim();
}

async function call(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(300000) });
    if (response.ok) return response;
    if ((response.status === 429 || response.status >= 500) && attempt < RETRY_DELAYS.length) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
      continue;
    }
    throw new Error(`HeyGen API error (${response.status}): ${(await response.text()).slice(0, 400)}`);
  }
}

export async function listHeyGenVoices(apiKey: string = heygenKey()): Promise<HeyGenVoice[]> {
  if (!apiKey) throw new Error('Enter the HeyGen key to list voices.');
  const response = await call(`${API}/v3/models/audio/voices?type=private&limit=100`, { headers: { 'X-Api-Key': apiKey } });
  const data = await response.json() as { data?: { voice_id: string; name: string; gender?: string | null; language?: string | null; status?: string }[] };
  return (data.data ?? [])
    .filter(v => v.status === undefined || v.status === 'ACTIVE')
    .map(v => ({ id: v.voice_id, name: v.name, gender: v.gender ?? null, language: v.language ?? null }));
}

// Returns MP3 audio for one piece of text in the given HeyGen voice.
export async function synthesizeHeyGen(text: string, voiceId: string, apiKey: string = heygenKey()): Promise<Buffer> {
  if (!apiKey) throw new Error('HEYGEN_API_KEY is not set. Add it in the Settings tab or to .env.');
  const response = await call(`${API}/v3/models/audio/tts`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice_id: voiceId, text, model: HEYGEN_MODEL, output_format: { encoding: 'mp3' } }),
  });
  const data = await response.json() as { data?: { audio_url?: string } };
  const url = data.data?.audio_url;
  if (!url) throw new Error('HeyGen returned no audio URL.');
  const audio = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!audio.ok) throw new Error(`HeyGen audio download failed (${audio.status}).`);
  return Buffer.from(await audio.arrayBuffer());
}
