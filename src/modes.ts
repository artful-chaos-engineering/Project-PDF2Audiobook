// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { complete } from './llm';

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

export interface Voices {
  speaker1: string;
  speaker2: string;
}

export interface Presentation {
  voices: Voices;
  intro: string;
  outro: string;
}

export const DEFAULT_VOICES: Voices = { speaker1: 'matilda', speaker2: 'mark' };

export interface Segment {
  voice: string;
  speaker: string;
  text: string;
  pauseAfter: number;
  // Segments that share a group are one exchange between the speakers and are rendered in a single take.
  group?: number;
}

export interface Turn {
  speaker: 'A' | 'B';
  text: string;
}

export const MIN_TURN_WORDS = 20;
export const MAX_TURN_WORDS = 80;

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
  heading: () => sample(1.0, 0.2, 0.6, 1.5),
  section: () => sample(1.2, 0.25, 0.8, 1.8),
  paragraph: () => sample(0.6, 0.12, 0.4, 0.9),
  speakerChange: () => sample(0.35, 0.1, 0.2, 0.6),
};

const AUDIENCE_NOTES: Record<Audience, string> = {
  technical: 'The listener is an engineer. Keep the specific mechanisms, terms, numbers and examples from the text.',
  managerial: 'The listener is a manager. Focus on decisions, costs, risks, benefits and what to do about them, in plain language with little jargon.',
};

const TURN_RULES = `Rules for the turns:
- Every turn has at least ${MIN_TURN_WORDS} words and makes a point from the text. There are no one-line reactions and no turns that only agree, prompt or ask "such as?".
- No turn is longer than about 80 words. Break a longer explanation into an exchange instead.
- A speaker may open a turn with a short transition that responds to the other speaker, for example "That's a good point, and..." or "I'm not sure I agree with that last point, because...". A transition is always the start of a longer turn, never a turn by itself. Use each transition phrase at most once.
- No filler sounds such as "ooh", "wow", "hmm", "ha" or "uh".
- The speakers alternate.`;

// Delivery tags are interpreted only by these models, and only when switched on in .env.
const TAG_MODELS = ['eleven_v4', 'eleven_v3'];
const DELIVERY_TAG_RULE = `
- You may place one of these delivery tags at the start of a turn where the words call for it: [laughs], [sighs], [whispers]. Use at most one tag in every three turns, and never inside a sentence.`;

function turnRules(): string {
  const tagsOn = TAG_MODELS.includes(process.env.TTS_MODEL || 'eleven_v4') && (process.env.AUDIO_TAGS || 'off').toLowerCase() === 'on';
  return tagsOn ? TURN_RULES + DELIVERY_TAG_RULE : TURN_RULES;
}

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
  return complete(prompt, 16000);
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

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function mergeAdjacentTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  for (const turn of turns) {
    const last = out[out.length - 1];
    if (last && last.speaker === turn.speaker) last.text = `${last.text} ${turn.text}`;
    else out.push({ ...turn });
  }
  return out;
}

export function shortTurns(turns: Turn[]): Turn[] {
  return turns.filter(t => wordCount(t.text) < MIN_TURN_WORDS);
}

export function splitLongTurns(turns: Turn[], maxWords: number = MAX_TURN_WORDS): Turn[] {
  const out: Turn[] = [];
  for (const turn of turns) {
    const turnStart = out.length;
    const sentences = turn.text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [turn.text];
    let current: string[] = [];
    let count = 0;
    for (const sentence of sentences) {
      const n = wordCount(sentence);
      if (current.length > 0 && count + n > maxWords) {
        out.push({ speaker: turn.speaker, text: current.join(' ').trim() });
        current = [];
        count = 0;
      }
      current.push(sentence.trim());
      count += n;
    }
    if (current.length > 0) out.push({ speaker: turn.speaker, text: current.join(' ').trim() });
    // A fragment too short to stand alone joins the piece before it, so the minimum still holds.
    const pieces = out.splice(turnStart);
    for (const piece of pieces) {
      const last = out[out.length - 1];
      if (last && last.speaker === piece.speaker && wordCount(piece.text) < MIN_TURN_WORDS) {
        last.text = `${last.text} ${piece.text}`;
      } else {
        out.push(piece);
      }
    }
  }
  return out;
}

export function enforceTurnLength(turns: Turn[]): { turns: Turn[]; dropped: number } {
  const merged = mergeAdjacentTurns(turns);
  const kept = merged.filter(t => wordCount(t.text) >= MIN_TURN_WORDS);
  return { turns: splitLongTurns(mergeAdjacentTurns(kept)), dropped: merged.length - kept.length };
}

async function scriptTurns(prompt: string, label: string, log: (msg: string) => void): Promise<Turn[]> {
  let turns = mergeAdjacentTurns(parseTurns(await askClaude(prompt)));
  const short = shortTurns(turns);
  if (short.length > 0) {
    const retry = `${prompt}

A previous attempt broke the rule that every turn has at least ${MIN_TURN_WORDS} words. These turns were too short:
${short.map(t => `- ${t.speaker}: ${t.text}`).join('\n')}
Write the script again so that every turn has at least ${MIN_TURN_WORDS} words. Fold each short line into a longer turn and keep every fact.`;
    turns = mergeAdjacentTurns(parseTurns(await askClaude(retry)));
  }
  const result = enforceTurnLength(turns);
  if (result.dropped > 0) log(`   ${label}: dropped ${result.dropped} turn(s) under ${MIN_TURN_WORDS} words`);
  if (result.turns.length === 0) throw new Error(`${label}: the script has no turn of at least ${MIN_TURN_WORDS} words`);
  return result.turns;
}

const CHARS_PER_SECOND = 15;
const minimumHold = () => sample(4.0, 1.0, 2.5, 6.0);

export function narrationSegments(sections: string[], voices: Voices): Segment[] {
  const items: { heading: boolean; text: string; endsSection: boolean }[] = [];
  for (const section of sections) {
    const { heading, body } = splitHeading(section);
    if (heading) items.push({ heading: true, text: heading, endsSection: body.length === 0 });
    body.forEach((text, i) => items.push({ heading: false, text, endsSection: i === body.length - 1 }));
  }

  let current: 'A' | 'B' = 'A';
  let held = 0;
  let need = minimumHold();
  return items.map(item => {
    // A heading and the paragraph after it share a voice: the switch is decided at the heading,
    // which resets the hold, and a heading adds nothing to it, so the paragraph cannot switch again.
    if (held >= need) {
      current = current === 'A' ? 'B' : 'A';
      held = 0;
      need = minimumHold();
    }
    if (!item.heading) held += item.text.length / CHARS_PER_SECOND;
    const voice = current === 'A' ? voices.speaker1 : voices.speaker2;
    const pauseAfter = item.heading ? pause.heading() : item.endsSection ? pause.section() : pause.paragraph();
    return { voice, speaker: current, text: item.text, pauseAfter };
  });
}

export function dialogueSegments(blocks: Turn[][], voices: Voices): Segment[] {
  const segments: Segment[] = [];
  blocks.forEach((turns, group) => {
    turns.forEach((turn, i) => {
      segments.push({
        voice: turn.speaker === 'A' ? voices.speaker1 : voices.speaker2,
        speaker: turn.speaker,
        text: turn.text,
        pauseAfter: i === turns.length - 1 ? pause.section() : pause.speakerChange(),
        group,
      });
    });
  });
  return segments;
}

function paragraphSegments(paragraphs: string[], voice: string, headingText: string | null): Segment[] {
  const out: Segment[] = [];
  if (headingText) out.push({ voice, speaker: voice, text: headingText, pauseAfter: pause.heading() });
  paragraphs.forEach((paragraph, i) => {
    const pauseAfter = i === paragraphs.length - 1 ? pause.section() : pause.paragraph();
    out.push({ voice, speaker: voice, text: paragraph, pauseAfter });
  });
  return out;
}

function alreadyHeard(spoken: string, position: 'before' | 'after'): string {
  if (!spoken.trim()) return '';
  return position === 'before'
    ? `\nThe listener has just heard this spoken introduction: "${spoken.trim()}". Do not repeat it and do not greet the listener again; carry on from it.`
    : `\nRight after this, the listener will hear this sign-off: "${spoken.trim()}". Do not repeat it and do not say goodbye.`;
}

function continuity(part: number, total: number, heading: string | null, previous: Turn[]): string {
  const lines = [
    `This is part ${part} of ${total} of one continuous conversation that is already under way. Do not greet the listener, do not introduce the document or the speakers again, and do not say goodbye.`,
  ];
  if (heading) {
    const title = heading.replace(/^\d{1,2}\s+/, '');
    lines.push(`This part covers the section titled "${title}". Have the first speaker lead into that topic in a natural sentence; do not read the title out as a heading.`);
  }
  if (previous.length > 0) {
    lines.push(`The conversation so far ended with:\n${previous.map(t => `${t.speaker}: ${t.text}`).join('\n')}\nContinue from there.`);
  }
  return lines.join('\n');
}

const DIALOGUE_FORMAT = (instructions: string, label: string, text: string) => `${instructions}

${turnRules()}

${label}:
${text}

Return ONLY a JSON array of objects like {"speaker": "A", "text": "..."}, with no other output.`;

const PODCAST_PROMPT = (text: string) => DIALOGUE_FORMAT(`Rewrite this section of a technical document as part of a podcast conversation between two hosts.
Speaker A is the host who leads and asks the questions. Speaker B is the expert who explains.
Cover every idea in the section, in the same order, with the same facts. Make it sound natural and conversational.
Do not add facts that are not in the text. Do not read headings or page numbers aloud.`, 'TEXT', text);

const DEEP_DIVE_PROMPT = (text: string) => DIALOGUE_FORMAT(`Turn this section of a technical document into part of a deep-dive conversation between two hosts.
Speaker A asks the questions a careful listener would ask. Speaker B explains each idea in full, step by step, with the reasoning, examples and implications the text gives.
Cover every substantive point in the section, in order; do not skip any idea. Do not add facts that are not in the text. Do not read headings or page numbers aloud.`, 'TEXT', text);

const DEBATE_PROMPT = (text: string) => DIALOGUE_FORMAT(`Turn this section of a technical document into part of a debate between two speakers.
Speaker A argues for the main claims of the text. Speaker B challenges them with the strongest counterarguments and open questions the text raises.
Ground every point in the text; do not invent facts or statistics. Cover every main claim in the section.`, 'TEXT', text);

const INTRO_PROMPT = (opening: string, kind: string, spokenIntro: string) => DIALOGUE_FORMAT(`Write the opening of a ${kind} between two speakers that introduces this document: what it is, who wrote it if the text says so, and what the listener will learn. Use 2 to 4 turns. Use only facts from the text.${alreadyHeard(spokenIntro, 'before')}`, 'TEXT', opening);

const CLOSING_PROMPT = (script: string, spokenOutro: string) => DIALOGUE_FORMAT(`Write the closing of this conversation between two speakers. Recap the key points of the conversation below, in the order they were made, then end with one open question for the listener to think about. Use 2 to 4 turns. Use only points from the conversation.${alreadyHeard(spokenOutro, 'after')}`, 'CONVERSATION', script);

const SUMMARY_PROMPT = (text: string) => `Summarize this section of a technical document for listening.
Cover every main point of the section in 3 to 6 plain sentences. No lists, no headings, no page numbers.
Use only facts from the text.

TEXT:
${text}

Output ONLY the summary.`;

const INTRO_SUMMARY_PROMPT = (opening: string, spokenIntro: string) => `Write a short spoken introduction for a summary of this document: what it is, who wrote it if the text says so, and what the listener will learn. 2 to 3 plain sentences. Use only facts from the text.${alreadyHeard(spokenIntro, 'before')}

TEXT:
${opening}

Output ONLY the introduction.`;

const CLOSING_SUMMARY_PROMPT = (summaries: string, spokenOutro: string) => `Write a short spoken closing for a summary, recapping the main points below in order and ending with one sentence on what to do next. 2 to 4 plain sentences. Use only points from the summaries.${alreadyHeard(spokenOutro, 'after')}

SUMMARIES:
${summaries}

Output ONLY the closing.`;

export async function buildSegments(
  mode: Mode,
  sections: string[],
  log: (msg: string) => void = () => {},
  presentation: Presentation = { voices: DEFAULT_VOICES, intro: '', outro: '' },
): Promise<Segment[]> {
  const body = await buildBody(mode, sections, log, presentation);
  const opening = paragraphSegments(splitParagraphs(presentation.intro), presentation.voices.speaker1, null);
  const closing = paragraphSegments(splitParagraphs(presentation.outro), presentation.voices.speaker1, null);
  return [...opening, ...body, ...closing];
}

async function buildBody(mode: Mode, sections: string[], log: (msg: string) => void, presentation: Presentation): Promise<Segment[]> {
  const { voices, intro, outro } = presentation;
  if (mode === 'narration') return narrationSegments(sections, voices);

  const audience = audienceOf(mode);
  const note = audience ? `${AUDIENCE_NOTES[audience]}\n\n` : '';
  const format = formatOf(mode);
  const opening = sections[0].slice(0, 4000);

  if (format === 'summary') {
    const lead = splitParagraphs(await askClaude(note + INTRO_SUMMARY_PROMPT(opening, intro)));
    const segments = paragraphSegments(lead, voices.speaker1, null);
    const summaries: string[] = [];
    for (const [i, section] of sections.entries()) {
      log(`   Script ${i + 1}/${sections.length}`);
      const { heading } = splitHeading(section);
      const summary = splitParagraphs(await askClaude(note + SUMMARY_PROMPT(section)));
      summaries.push(summary.join('\n\n'));
      segments.push(...paragraphSegments(summary, voices.speaker1, heading));
    }
    const closing = splitParagraphs(await askClaude(note + CLOSING_SUMMARY_PROMPT(summaries.join('\n\n').slice(0, 60000), outro)));
    segments.push(...paragraphSegments(closing, voices.speaker1, null));
    return segments;
  }

  const kind = format === 'deep-dive' ? 'deep dive' : format;
  const prompts: Record<Exclude<Format, 'summary'>, (text: string) => string> = {
    podcast: PODCAST_PROMPT,
    debate: DEBATE_PROMPT,
    'deep-dive': DEEP_DIVE_PROMPT,
  };
  const total = sections.length + 2;
  const blocks: Turn[][] = [await scriptTurns(note + INTRO_PROMPT(opening, kind, intro), 'Opening', log)];
  for (const [i, section] of sections.entries()) {
    log(`   Script ${i + 1}/${sections.length}`);
    const { heading } = splitHeading(section);
    const context = continuity(i + 2, total, heading, blocks[blocks.length - 1].slice(-2));
    blocks.push(await scriptTurns(`${note}${context}\n\n${prompts[format](section)}`, `Section ${i + 1}`, log));
  }
  const script = blocks
    .flat()
    .map(t => `${t.speaker}: ${t.text}`)
    .join('\n')
    .slice(0, 60000);
  blocks.push(await scriptTurns(note + CLOSING_PROMPT(script, outro), 'Closing', log));
  return dialogueSegments(blocks, voices);
}
