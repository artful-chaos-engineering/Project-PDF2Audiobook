import * as fs from 'fs';

const Anthropic = require('@anthropic-ai/sdk').default;

export interface CleaningResult {
  narrativeText: string;
  summaries: { type: string; content: string }[];
  removed: {
    headers: number;
    footers: number;
    toc: number;
    references: number;
    glossary: number;
    code: number;
    tables: number;
    figures: number;
  };
}

const MAX_SECTION_CHARS = 12000;

export function splitIntoSections(fullText: string): string[] {
  const headingRe = /^\d{1,2} [A-Z][^\n]{2,80}$/gm;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(fullText)) !== null) {
    if (m[0].includes('....')) continue;
    starts.push(m.index);
  }

  const raw: string[] = [];
  const bounds = [0, ...starts.filter(s => s > 0), fullText.length];
  for (let i = 0; i < bounds.length - 1; i++) {
    const piece = fullText.slice(bounds[i], bounds[i + 1]).trim();
    if (piece) raw.push(piece);
  }

  const sections: string[] = [];
  for (const piece of raw) {
    if (piece.length <= MAX_SECTION_CHARS) {
      sections.push(piece);
      continue;
    }
    let current = '';
    for (const para of piece.split(/\n\s*\n/)) {
      const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [para];
      for (const s of sentences) {
        if ((current + s).length > MAX_SECTION_CHARS && current.trim()) {
          sections.push(current.trim());
          current = '';
        }
        current += s;
      }
      current += '\n\n';
    }
    if (current.trim()) sections.push(current.trim());
  }
  return sections;
}

export async function cleanWithLLM(fullText: string): Promise<CleaningResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY required');
  }

  const client = new Anthropic({ apiKey });

  const prompt = `Extract clean narrative text from this document for audiobook conversion.

TEXT:
${fullText}

Return the narrative text exactly as it should be read, removing:
- Table of contents entries
- Headers and footers
- References section
- Glossary entries
- Code blocks
- Figure captions and table data (can be replaced with brief summaries)

Output ONLY the cleaned narrative text, nothing else. If the text contains no narrative at all, output nothing.`;

  try {
    const message = await client.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    });

    const narrative = message.content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('')
      .trim();

    return {
      narrativeText: narrative,
      summaries: [],
      removed: {
        toc: fullText.includes('Table of Contents') ? 1 : 0,
        references: fullText.includes('References') ? 1 : 0,
        glossary: fullText.includes('Glossary') ? 1 : 0,
        headers: 0,
        footers: 0,
        code: 0,
        tables: 0,
        figures: 0,
      },
    };
  } catch (error) {
    throw new Error(`Cleaning failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
