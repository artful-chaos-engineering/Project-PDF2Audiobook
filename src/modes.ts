// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

const Anthropic = require('@anthropic-ai/sdk').default;

export const FORMATS = ['podcast', 'debate', 'deep-dive', 'summary'] as const;
export type Format = typeof FORMATS[number];

export const AUDIENCES = ['technical', 'managerial'] as const;
export type Audience = typeof AUDIENCES[number];

export const MODES = [
  'narration',
  'podcast',
  'debate',
  'summary',
  ...AUDIENCES.flatMap(a => FORMATS.map(f => `${a}-${f}`)),
] as const;
export type Mode = typeof MODES[number];

export const FEMALE_VOICE = 'sarah';
export const MALE_VOICE = 'brian';

export interface Segment {
  voice: string;
  speaker: string;
  text: string;
  pauseAfter: number;
  speed: number;
}

interface Turn {
  speaker: 'A' | 'B';
  text: string;
}

interface Block {
  heading: string | null;
  turns: Turn[];
}

const HEADING_RE = /^\d{1,2} [A-Z][^\n]{2,80}$/;

function gaussian(mean: number, sd: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sample(mean: number, sd: number, min: number, max: number): number {
  const value = Math.min(max, Math.max(min, gaussian(mean, sd)));
  return Math.round(value * 100) / 100;
}

const pause = {
  heading: () => sample(2.0, 0.4, 1.2, 3.0),
  paragraph: () => sample(0.8, 0.25, 0.4, 1.6),
  speakerChange: () => sample(0.55, 0.15, 0.25, 1.2),
  sameSpeaker: () => sample(0.2, 0.08, 0.05, 0.5),
};

const speed = () => sample(0.9, 0.025, 0.85, 0.95);

const AUDIENCE_NOTES: Record<Audience, string> = {
  technical: 'The listener is an engineer. Keep the specific mechanisms, terms, numbers and examples from the text.',
  managerial: 'The listener is a manager. Focus on decisions, costs, risks, benefits and what to do about them, in plain language with little jargon.',
};

const TRANSITIONS = `Between points, include natural reactions and transitions in the speakers' lines, for example "That's a good point", "I'm not sure I agree with that last point", "Hold on, let's go back to that", "Right, so what does that mean in practice?". Vary the wording, use each phrase at most once in the script, and let some turns be only a few words.`;

export function parseMode(value: string | undefined): Mode {
  const mode = (value || 'narration').toLowerCase();
  if (!(MODES as readonly string[]).includes(mode)) {
    throw new Error(`Unknown mode "${value}". Use one of: ${MODES.join(', ')}`);
  }
  return mode as Mode;
}

function audienceOf(mode: Mode): Audience | undefined {
  return AUDIENCES.find(a => mode.startsWith(`${a}-`));
}

function formatOf(mode: Mode): Format {
  const audience = audienceOf(mode);
  return (audience ? mode.slice(audience.length + 1) : mode) as Format;
}

function splitHeading(section: string): { heading: string | null; body: string[] } {
  const lines = section.split('\n');
  const first = lines[0].trim();
  if (HEADING_RE.test(first)) {
    return { heading: first, body: splitParagraphs(lines.slice(1).join('\n')) };
  }
  return { heading: null, body: splitParagraphs(section) };
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

async function askClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
  const client = new Anthropic({ apiKey, timeout: 600000, maxRetries: 4 });
  const message = await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = message.content
    .filter((c: { type: string }) => c.type === 'text')
    .map((c: { text: string }) => c.text)
    .join('')
    .trim();
  if (!text) throw new Error('Script model returned no text');
  return text;
}

function parseTurns(raw: string): Turn[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error('Script model did not return a JSON array');
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Script model did not return a JSON array');
  return parsed.map((t: { speaker?: string; text?: string }) => {
    if ((t.speaker !== 'A' && t.speaker !== 'B') || typeof t.text !== 'string' || !t.text.trim()) {
      throw new Error(`Invalid script turn: ${JSON.stringify(t)}`);
    }
    return { speaker: t.speaker, text: t.text.trim() };
  });
}

function narrationSegments(sections: string[]): Segment[] {
  const segments: Segment[] = [];
  let unit = 0;
  for (const section of sections) {
    const { heading, body } = splitHeading(section);
    if (heading) {
      const voice = unit % 2 === 0 ? FEMALE_VOICE : MALE_VOICE;
      segments.push({ voice, speaker: 'heading', text: heading, pauseAfter: pause.heading(), speed: speed() });
      unit++;
    }
    for (const paragraph of body) {
      const voice = unit % 2 === 0 ? FEMALE_VOICE : MALE_VOICE;
      segments.push({ voice, speaker: voice, text: paragraph, pauseAfter: pause.paragraph(), speed: speed() });
      unit++;
    }
  }
  return segments;
}

function dialogueSegments(blocks: Block[]): Segment[] {
  const segments: Segment[] = [];
  for (const { heading, turns } of blocks) {
    if (heading) {
      segments.push({ voice: FEMALE_VOICE, speaker: 'heading', text: heading, pauseAfter: pause.heading(), speed: speed() });
    }
    turns.forEach((turn, i) => {
      const next = turns[i + 1];
      const pauseAfter = !next ? pause.paragraph() : next.speaker === turn.speaker ? pause.sameSpeaker() : pause.speakerChange();
      segments.push({
        voice: turn.speaker === 'A' ? FEMALE_VOICE : MALE_VOICE,
        speaker: turn.speaker,
        text: turn.text,
        pauseAfter,
        speed: speed(),
      });
    });
  }
  return segments;
}

function paragraphSegments(paragraphs: string[], voice: string, headingText: string | null): Segment[] {
  const out: Segment[] = [];
  if (headingText) out.push({ voice, speaker: 'heading', text: headingText, pauseAfter: pause.heading(), speed: speed() });
  for (const paragraph of paragraphs) {
    out.push({ voice, speaker: voice, text: paragraph, pauseAfter: pause.paragraph(), speed: speed() });
  }
  return out;
}

const DIALOGUE_FORMAT = (kind: string, text: string) => `${kind}

${text}

Return ONLY a JSON array of objects like {"speaker": "A", "text": "..."}, with no other output.`;

const PODCAST_PROMPT = (text: string) => DIALOGUE_FORMAT(`Rewrite this section of a technical document as a podcast conversation between two hosts.
Speaker A is the host who leads and asks the questions. Speaker B is the expert who explains.
Cover every idea in the section, in the same order, with the same facts. Make it sound natural and conversational, with short turns.
${TRANSITIONS}
Do not add facts that are not in the text. Do not read headings or page numbers aloud.

TEXT:`, text);

const DEEP_DIVE_PROMPT = (text: string) => DIALOGUE_FORMAT(`Turn this section of a technical document into a deep-dive conversation between two hosts.
Speaker A asks the questions a careful listener would ask. Speaker B explains each idea in full, step by step, with the reasoning, examples and implications the text gives.
Cover every substantive point in the section, in order; do not skip any idea. Do not add facts that are not in the text. Do not read headings or page numbers aloud.
${TRANSITIONS}

TEXT:`, text);

const DEBATE_PROMPT = (text: string) => DIALOGUE_FORMAT(`Turn this section of a technical document into a debate between two speakers.
Speaker A argues for the main claims of the text. Speaker B challenges them with the strongest counterarguments and open questions the text raises.
Ground every point in the text; do not invent facts or statistics. Cover every main claim in the section.
${TRANSITIONS}

TEXT:`, text);

const INTRO_PROMPT = (opening: string, kind: string) => DIALOGUE_FORMAT(`Write the opening of a ${kind} between two speakers that introduces this document: what it is, who wrote it if the text says so, and what the listener will learn. Use 3 to 6 turns. Use only facts from the text.
${TRANSITIONS}

TEXT:`, opening);

const CLOSING_PROMPT = (script: string) => DIALOGUE_FORMAT(`Write the closing of this conversation between two speakers. Recap the key points of the conversation below, in the order they were made, then end with one open question for the listener to think about. Use 4 to 8 turns. Use only points from the conversation.

CONVERSATION:`, script);

const SUMMARY_PROMPT = (text: string) => `Summarize this section of a technical document for listening.
Cover every main point of the section in 3 to 6 plain sentences. No lists, no headings, no page numbers.
Use only facts from the text.

TEXT:
${text}

Output ONLY the summary.`;

const INTRO_SUMMARY_PROMPT = (opening: string) => `Write a short spoken introduction for a summary of this document: what it is, who wrote it if the text says so, and what the listener will learn. 2 to 3 plain sentences. Use only facts from the text.

TEXT:
${opening}

Output ONLY the introduction.`;

const CLOSING_SUMMARY_PROMPT = (summaries: string) => `Write a short spoken closing for a summary, recapping the main points below in order and ending with one sentence on what to do next. 2 to 4 plain sentences. Use only points from the summaries.

SUMMARIES:
${summaries}

Output ONLY the closing.`;

export async function buildSegments(mode: Mode, sections: string[]): Promise<Segment[]> {
  if (mode === 'narration') return narrationSegments(sections);

  const audience = audienceOf(mode);
  const note = audience ? `${AUDIENCE_NOTES[audience]}\n\n` : '';
  const format = formatOf(mode);
  const opening = sections[0].slice(0, 4000);

  if (format === 'summary') {
    const intro = splitParagraphs(await askClaude(note + INTRO_SUMMARY_PROMPT(opening)));
    const segments = paragraphSegments(intro, FEMALE_VOICE, null);
    const summaries: string[] = [];
    for (const section of sections) {
      const { heading } = splitHeading(section);
      const summary = splitParagraphs(await askClaude(note + SUMMARY_PROMPT(section)));
      summaries.push(summary.join('\n\n'));
      segments.push(...paragraphSegments(summary, FEMALE_VOICE, heading));
    }
    const closing = splitParagraphs(await askClaude(note + CLOSING_SUMMARY_PROMPT(summaries.join('\n\n').slice(0, 60000))));
    segments.push(...paragraphSegments(closing, FEMALE_VOICE, null));
    return segments;
  }

  const kind = format === 'deep-dive' ? 'deep dive' : format;
  const prompts: Record<Exclude<Format, 'summary'>, (text: string) => string> = {
    podcast: PODCAST_PROMPT,
    debate: DEBATE_PROMPT,
    'deep-dive': DEEP_DIVE_PROMPT,
  };
  const blocks: Block[] = [{ heading: null, turns: parseTurns(await askClaude(note + INTRO_PROMPT(opening, kind))) }];
  for (const section of sections) {
    const { heading } = splitHeading(section);
    blocks.push({ heading, turns: parseTurns(await askClaude(note + prompts[format](section))) });
  }
  const script = blocks
    .flatMap(b => b.turns)
    .map(t => `${t.speaker}: ${t.text}`)
    .join('\n')
    .slice(0, 60000);
  blocks.push({ heading: null, turns: parseTurns(await askClaude(note + CLOSING_PROMPT(script))) });
  return dialogueSegments(blocks);
}
