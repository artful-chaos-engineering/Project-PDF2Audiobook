// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

const Anthropic = require('@anthropic-ai/sdk').default;

export type LlmProviderId = 'anthropic' | 'openai' | 'openrouter' | 'openai_compatible' | 'lmstudio' | 'ollama';

export interface LlmProviderInfo {
  id: LlmProviderId;
  label: string;
  // Environment variable holding the API key, when the provider needs one.
  keyVar?: string;
  keyRequired: boolean;
  // Environment variable holding the server address, for providers with a configurable address.
  baseVar?: string;
  defaultBase?: string;
}

export const LLM_PROVIDERS: LlmProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', keyVar: 'ANTHROPIC_API_KEY', keyRequired: true },
  { id: 'openai', label: 'OpenAI', keyVar: 'OPENAI_API_KEY', keyRequired: true },
  { id: 'openrouter', label: 'OpenRouter', keyVar: 'OPENROUTER_API_KEY', keyRequired: true },
  { id: 'openai_compatible', label: 'OpenAI Compatible', keyVar: 'OPENAI_COMPATIBLE_API_KEY', keyRequired: false, baseVar: 'OPENAI_COMPATIBLE_BASE_URL' },
  { id: 'lmstudio', label: 'LM Studio', keyRequired: false, baseVar: 'LMSTUDIO_BASE_URL', defaultBase: 'http://localhost:1234/v1' },
  { id: 'ollama', label: 'Ollama', keyRequired: false, baseVar: 'OLLAMA_BASE_URL', defaultBase: 'http://localhost:11434/v1' },
];

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const TIMEOUT_MS = 600000;
const RETRY_DELAYS = [2000, 8000, 20000];

export function providerInfo(id: string): LlmProviderInfo {
  const found = LLM_PROVIDERS.find(p => p.id === id);
  if (!found) throw new Error(`Unknown LLM provider "${id}". Use one of: ${LLM_PROVIDERS.map(p => p.id).join(', ')}`);
  return found;
}

export function llmProvider(): LlmProviderInfo {
  return providerInfo(process.env.LLM_PROVIDER || 'anthropic');
}

export function llmModel(): string {
  return process.env.LLM_MODEL || DEFAULT_MODEL;
}

export function baseUrlFor(info: LlmProviderInfo, override?: string): string {
  const value = (override || (info.baseVar ? process.env[info.baseVar] : '') || info.defaultBase || '').trim();
  return value.replace(/\/+$/, '');
}

export function keyFor(info: LlmProviderInfo): string {
  return info.keyVar ? (process.env[info.keyVar] ?? '').trim() : '';
}

// Throws with the name of the missing setting, so a run never starts half-configured.
export function assertLlmReady(): void {
  const info = llmProvider();
  if (info.keyRequired && !keyFor(info)) {
    throw new Error(`${info.keyVar} is not set. Add it in the Settings tab or to .env.`);
  }
  if (info.baseVar && !baseUrlFor(info)) {
    throw new Error(`${info.baseVar} is not set.`);
  }
}

async function withRetries<T>(run: () => Promise<T>, isRetryable: (error: unknown) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt < RETRY_DELAYS.length && isRetryable(error)) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
        continue;
      }
      throw error;
    }
  }
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : undefined;
}

async function completeAnthropic(prompt: string, maxTokens: number, model: string, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
  const message: { content: { type: string; text?: string }[] } = await withRetries(
    () => client.messages.create({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    error => { const s = statusOf(error); return s === undefined || s === 429 || s >= 500; },
  );
  return message.content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('')
    .trim();
}

async function completeOpenAi(prompt: string, maxTokens: number, model: string, base: string, apiKey: string): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
  const data = await withRetries(async () => {
    const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      const error = new Error(`${base}/chat/completions returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
      (error as Error & { status: number }).status = response.status;
      throw error;
    }
    return await response.json() as { choices?: { message?: { content?: string } }[] };
  }, error => { const s = statusOf(error); return s === undefined || s === 429 || s >= 500; });
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

export async function complete(prompt: string, maxTokens = 16000): Promise<string> {
  assertLlmReady();
  const info = llmProvider();
  const model = llmModel();
  const text = info.id === 'anthropic'
    ? await completeAnthropic(prompt, maxTokens, model, keyFor(info))
    : await completeOpenAi(prompt, maxTokens, model, baseUrlFor(info), keyFor(info));
  if (!text) throw new Error(`${info.label} returned no text for model ${model}.`);
  return text;
}

// Lists the models a provider offers. The key and address come from the arguments when given, so the
// Settings tab can show models before anything is saved.
export async function listModels(id: string, apiKey?: string, baseUrl?: string): Promise<string[]> {
  const info = providerInfo(id);
  const key = (apiKey || keyFor(info)).trim();
  if (info.keyRequired && !key) throw new Error(`Enter the ${info.label} key to list its models.`);
  let ids: string[];
  if (info.id === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Anthropic returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    ids = ((await response.json()) as { data: { id: string }[] }).data.map(m => m.id);
  } else {
    const base = info.id === 'openrouter' ? 'https://openrouter.ai/api/v1' : info.id === 'openai' ? 'https://api.openai.com/v1' : baseUrlFor(info, baseUrl);
    if (!base) throw new Error(`Enter the server address for ${info.label}.`);
    const headers: Record<string, string> = {};
    if (key) headers.Authorization = `Bearer ${key}`;
    let response: Response;
    try {
      response = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(30000) });
    } catch {
      throw new Error(`Could not reach ${info.label} at ${base}. Start its server, then try again.`);
    }
    if (!response.ok) throw new Error(`${info.label} returned ${response.status} from ${base}/models: ${(await response.text()).slice(0, 300)}`);
    ids = ((await response.json()) as { data: { id: string }[] }).data.map(m => m.id);
  }
  return [...new Set(ids)].sort();
}
