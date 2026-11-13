// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

export type VoiceServerId = 'elevenlabs' | 'heygen' | 'anthropic' | 'lmstudio' | 'ollama';

export interface VoiceServerInfo {
  id: VoiceServerId;
  label: string;
  // Null when the server can produce speech; otherwise the reason it cannot be selected.
  unavailable: string | null;
  keyVar?: string;
}

export const VOICE_SERVERS: VoiceServerInfo[] = [
  { id: 'elevenlabs', label: 'ElevenLabs', unavailable: null, keyVar: 'ELEVENLABS_API_KEY' },
  { id: 'heygen', label: 'HeyGen', unavailable: null, keyVar: 'HEYGEN_API_KEY' },
  { id: 'anthropic', label: 'Anthropic', unavailable: 'Anthropic has no text-to-speech API.' },
  { id: 'lmstudio', label: 'LM Studio', unavailable: 'LM Studio runs language models only, with no speech output.' },
  { id: 'ollama', label: 'Ollama', unavailable: 'Ollama runs language models only, with no speech output.' },
];

export function voiceServerId(): VoiceServerId {
  const id = (process.env.VOICE_PROVIDER || 'elevenlabs') as VoiceServerId;
  const info = VOICE_SERVERS.find(v => v.id === id);
  if (!info) throw new Error(`Unknown voice server "${id}". Use one of: ${VOICE_SERVERS.map(v => v.id).join(', ')}`);
  if (info.unavailable) throw new Error(`${info.label} cannot be the voice server: ${info.unavailable}`);
  return id;
}
