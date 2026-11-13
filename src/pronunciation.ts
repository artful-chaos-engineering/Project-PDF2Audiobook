// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import * as fs from 'fs';
import * as path from 'path';

const API = 'https://api.elevenlabs.io/v1';
const DICTIONARY_NAME = 'pdf2audiobook';
export const PRONUNCIATION_FILE = path.join(process.cwd(), 'pronunciations.json');
const MAX_RULES = 100;

export interface PronunciationRule {
  word: string;
  say: string;
}

interface PronunciationState {
  rules: PronunciationRule[];
  dictionary_id?: string;
  version_id?: string;
}

export interface DictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

export function parseRulesText(text: string): PronunciationRule[] {
  const rules: PronunciationRule[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const at = line.indexOf('=');
    if (at < 0) throw new Error(`Line ${index + 1}: write each rule as "word = how it is said".`);
    const word = line.slice(0, at).trim();
    const say = line.slice(at + 1).trim();
    if (!word || !say) throw new Error(`Line ${index + 1}: both the word and how it is said are needed.`);
    if (word.length > 100 || say.length > 200) throw new Error(`Line ${index + 1}: the word must be under 100 characters and the spoken form under 200.`);
    if (seen.has(word.toLowerCase())) throw new Error(`Line ${index + 1}: "${word}" appears more than once.`);
    seen.add(word.toLowerCase());
    rules.push({ word, say });
  });
  if (rules.length > MAX_RULES) throw new Error(`Keep to ${MAX_RULES} rules or fewer.`);
  return rules;
}

export function rulesToText(rules: PronunciationRule[]): string {
  return rules.map(r => `${r.word} = ${r.say}`).join('\n');
}

function readState(): PronunciationState {
  if (!fs.existsSync(PRONUNCIATION_FILE)) return { rules: [] };
  return JSON.parse(fs.readFileSync(PRONUNCIATION_FILE, 'utf-8')) as PronunciationState;
}

function writeState(state: PronunciationState): void {
  const tmp = `${PRONUNCIATION_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, PRONUNCIATION_FILE);
}

export function currentRules(): PronunciationRule[] {
  return readState().rules;
}

// Sends the rules to ElevenLabs as a dictionary version and records the version used in requests.
export async function saveRules(rules: PronunciationRule[], apiKey: string): Promise<DictionaryLocator | null> {
  const state = readState();
  if (rules.length === 0) {
    writeState({ rules: [] });
    return null;
  }
  const body = JSON.stringify({
    rules: rules.map(r => ({ type: 'alias', string_to_replace: r.word, alias: r.say, case_sensitive: false, word_boundaries: true })),
  });
  const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };
  let response: Response;
  if (state.dictionary_id) {
    response = await fetch(`${API}/pronunciation-dictionaries/${state.dictionary_id}/set-rules`, { method: 'POST', headers, body });
  } else {
    response = await fetch(`${API}/pronunciation-dictionaries/add-from-rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: DICTIONARY_NAME, description: 'Pronunciations for PDF to Audiobook', rules: JSON.parse(body).rules }),
    });
  }
  if (!response.ok) {
    throw new Error(`ElevenLabs pronunciation API error (${response.status}): ${await response.text()}`);
  }
  const data = await response.json() as { id?: string; version_id?: string };
  const dictionaryId = state.dictionary_id ?? data.id;
  if (!dictionaryId || !data.version_id) throw new Error('ElevenLabs did not return a dictionary version.');
  writeState({ rules, dictionary_id: dictionaryId, version_id: data.version_id });
  return { pronunciation_dictionary_id: dictionaryId, version_id: data.version_id };
}

export function activeLocators(): DictionaryLocator[] {
  const state = readState();
  if (state.rules.length === 0 || !state.dictionary_id || !state.version_id) return [];
  return [{ pronunciation_dictionary_id: state.dictionary_id, version_id: state.version_id }];
}
