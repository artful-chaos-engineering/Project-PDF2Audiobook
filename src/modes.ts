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

export const PAUSE_AFTER_HEADING = 2.0;
export const PAUSE_AFTER_PARAGRAPH = 0.6;
export const PAUSE_AFTER_TURN = 0.4;

export interface Segment {
  voice: string;
  text: string;
  pauseAfter: number;
}

interface Turn {
  speaker: 'A' | 'B';
  text: string;
}

const HEADING_RE = /^\d{1,2} [A-Z][^\n]{2,80}$/;

const AUDIENCE_NOTES: Record<Audience, string> = {
  technical: 'The listener is an engineer. Keep the specific mechanisms, terms, numbers and examples from the text.',
  managerial: 'The listener is a manager. Focus on decisions, costs, risks, benefits and what to do about them, in plain language with little jargon.',
};

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
    const body = lines.slice(1).join('\n');
    return { heading: first, body: splitParagraphs(body) };
  }
  return { heading: null, body: splitParagraphs(section) };
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

async function askClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 8000,
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
      segments.push({ voice: unit % 2 === 0 ? FEMALE_VOICE : MALE_VOICE, text: heading, pauseAfter: PAUSE_AFTER_HEADING });
      unit++;
    }
    for (const paragraph of body) {
      segments.push({ voice: unit % 2 === 0 ? FEMALE_VOICE : MALE_VOICE, text: paragraph, pauseAfter: PAUSE_AFTER_PARAGRAPH });
      unit++;
    }
  }
  return segments;
}

function dialogueSegments(sectionTurns: { heading: string | null; turns: Turn[] }[]): Segment[] {
  const segments: Segment[] = [];
  for (const { heading, turns } of sectionTurns) {
    if (heading) {
      segments.push({ voice: FEMALE_VOICE, text: heading, pauseAfter: PAUSE_AFTER_HEADING });
    }
    turns.forEach((turn, i) => {
      const voice = turn.speaker === 'A' ? FEMALE_VOICE : MALE_VOICE;
      const pauseAfter = i < turns.length - 1 ? PAUSE_AFTER_TURN : PAUSE_AFTER_PARAGRAPH;
      segments.push({ voice, text: turn.text, pauseAfter });
    });
  }
  return segments;
}

const PODCAST_PROMPT = (text: string) => `Rewrite this section of a technical document as a podcast conversation between two hosts.
Speaker A is the host who leads and asks the questions. Speaker B is the expert who explains.
Keep every important idea and fact from the text. Make it sound natural and conversational, with short turns.
Do not add facts that are not in the text. Do not read headings or page numbers aloud.

TEXT:
${text}

Return ONLY a JSON array of objects like {"speaker": "A", "text": "..."}, with no other output.`;

const DEEP_DIVE_PROMPT = (text: string) => `Turn this section of a technical document into a deep-dive conversation between two hosts.
Speaker A asks the questions a careful listener would ask. Speaker B explains each idea in full, step by step, with the reasoning, examples and implications the text gives.
Cover every substantive point in the section; do not skip any idea. Keep each turn focused, and do not add facts that are not in the text.
Do not read headings or page numbers aloud.

TEXT:
${text}

Return ONLY a JSON array of objects like {"speaker": "A", "text": "..."}, with no other output.`;

const DEBATE_PROMPT = (text: string) => `Turn this section of a technical document into a debate between two speakers.
Speaker A argues for the main claims of the text. Speaker B challenges them with the strongest counterarguments and open questions the text raises.
Ground every point in the text; do not invent facts or statistics. Keep the turns short and direct.

TEXT:
${text}

Return ONLY a JSON array of objects like {"speaker": "A", "text": "..."}, with no other output.`;

const SUMMARY_PROMPT = (text: string) => `Summarize this section of a technical document for listening.
Write 2 to 4 plain sentences that state the key ideas. No lists, no headings, no page numbers.
Use only facts from the text.

TEXT:
${text}

Output ONLY the summary.`;

export async function buildSegments(mode: Mode, sections: string[]): Promise<Segment[]> {
  if (mode === 'narration') return narrationSegments(sections);

  const audience = audienceOf(mode);
  const note = audience ? `${AUDIENCE_NOTES[audience]}\n\n` : '';
  const format = formatOf(mode);

  if (format === 'summary') {
    const segments: Segment[] = [];
    for (const section of sections) {
      const { heading } = splitHeading(section);
      if (heading) segments.push({ voice: FEMALE_VOICE, text: heading, pauseAfter: PAUSE_AFTER_HEADING });
      const summary = await askClaude(note + SUMMARY_PROMPT(section));
      for (const paragraph of splitParagraphs(summary)) {
        segments.push({ voice: FEMALE_VOICE, text: paragraph, pauseAfter: PAUSE_AFTER_PARAGRAPH });
      }
    }
    return segments;
  }

  const prompts: Record<Exclude<Format, 'summary'>, (text: string) => string> = {
    podcast: PODCAST_PROMPT,
    debate: DEBATE_PROMPT,
    'deep-dive': DEEP_DIVE_PROMPT,
  };
  const prompt = prompts[format];
  const sectionTurns: { heading: string | null; turns: Turn[] }[] = [];
  for (const section of sections) {
    const { heading } = splitHeading(section);
    const turns = parseTurns(await askClaude(note + prompt(section)));
    sectionTurns.push({ heading, turns });
  }
  return dialogueSegments(sectionTurns);
}
