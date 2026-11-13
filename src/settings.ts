// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import * as fs from 'fs';
import * as path from 'path';
import type { Mode } from './modes';
import { STANDARD_INTROS } from './standardIntros';

export const ENV_FILE = path.join(process.cwd(), '.env');
export const MAX_TEXT_CHARS = 5000;

export function envName(prefix: string, mode: string): string {
  return `${prefix}_${mode.toUpperCase().replace(/-/g, '_')}`;
}

export function encodeEnvValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/\r?\n/g, '\\n');
  return `"${escaped}"`;
}

export function decodeEnvValue(raw: string): string {
  let inner = raw.trim();
  if (inner.length >= 2 && inner.startsWith('"') && inner.endsWith('"')) inner = inner.slice(1, -1);
  return inner.replace(/\\([\\"$`n])/g, (_m, c: string) => (c === 'n' ? '\n' : c));
}

export function readSettings(mode: Mode): { intro: string; outro: string } {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) values.set(m[1], decodeEnvValue(m[2]));
  }
  const introKey = envName('INTRO', mode);
  const intro = values.has(introKey) ? values.get(introKey) ?? '' : STANDARD_INTROS[mode];
  return { intro, outro: values.get(envName('OUTRO', mode)) ?? '' };
}

export function writeSettings(mode: Mode, intro: string, outro: string): void {
  const updates = new Map<string, string>([
    [envName('INTRO', mode), encodeEnvValue(intro)],
    [envName('OUTRO', mode), encodeEnvValue(outro)],
  ]);
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8').split('\n') : [];
  const seen = new Set<string>();
  const out = lines.map(line => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && updates.has(m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${updates.get(m[1])}`;
    }
    return line;
  });
  for (const [key, value] of updates) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
}

export function setEnvValue(key: string, value: string): void {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8').split('\n') : [];
  let found = false;
  const out = lines.map(line => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  while (out.length && out[out.length - 1] === '') out.pop();
  const tmp = `${ENV_FILE}.tmp`;
  fs.writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, ENV_FILE);
}
