import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type { ExtractedContent, Page, ContentElement } from './types';

export class PDFExtractor {
  async extractFromFile(pdfPath: string): Promise<ExtractedContent> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
    const scriptFile = path.join(tmpDir, 'extract.py');
    const outputFile = path.join(tmpDir, 'extracted.txt');

    try {
      const script = `
import pypdf
with open('${pdfPath}', 'rb') as f:
    reader = pypdf.PdfReader(f)
    with open('${outputFile}', 'w') as out:
        for i, page in enumerate(reader.pages, 1):
            out.write(f'=== PAGE {i} ===\\n')
            text = page.extract_text() or ''
            out.write(text + '\\n\\n')
`;

      fs.writeFileSync(scriptFile, script);
      execSync(`python3 "${scriptFile}"`, { encoding: 'utf-8' });

      if (!fs.existsSync(outputFile)) {
        throw new Error(`Output file not created: ${outputFile}`);
      }

      const output = fs.readFileSync(outputFile, 'utf-8');
      
      const pageTexts = output.split('=== PAGE ').slice(1);
      if (!pageTexts || pageTexts.length === 0) {
        throw new Error('No pages extracted from PDF');
      }

      const pages: Page[] = pageTexts.map((pageText, idx) => {
        const lines = pageText.split('\n');
        const pageNum = parseInt(lines[0]) || idx + 1;
        const text = lines.slice(1).join('\n');

        return {
          pageNumber: pageNum,
          text,
          elements: this.identifyElements(text, pageNum),
        };
      });

      return {
        pages,
        metadata: {
          title: 'Document',
          pageCount: pages.length,
        },
      };
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch (e) {}
    }
  }

  private identifyElements(text: string, pageNum: number): ContentElement[] {
    const elements: ContentElement[] = [];
    const lines = text.split('\n');

    let inTOC = false, inReferences = false, inGlossary = false, inCode = false;
    let tableBuffer: string[] = [];
    const bodyLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;

      // Detect code blocks (indented code, backticks, etc.)
      if (this.looksLikeCode(trimmed, line)) {
        inCode = true;
        elements.push({ type: 'glossary', content: trimmed }); // Treat as non-narrative
        continue;
      }

      if (inCode && !trimmed.match(/^[A-Z]/)) {
        elements.push({ type: 'glossary', content: trimmed });
        continue;
      }
      if (inCode) inCode = false;

      // Detect headers
      if (i === 0 && this.looksLikeHeader(trimmed)) {
        elements.push({ type: 'header', content: trimmed });
        continue;
      }

      // Detect footers
      if (i === lines.length - 1 && this.looksLikeFooter(trimmed)) {
        elements.push({ type: 'footer', content: trimmed });
        continue;
      }

      // Detect TOC
      if (/^table\s+of\s+contents$/i.test(trimmed)) {
        inTOC = true; inReferences = false; inGlossary = false;
        elements.push({ type: 'toc', content: trimmed });
        continue;
      }

      // Detect References
      if (/^\d*\.?\s*references$/i.test(trimmed) || /^\d*\.?\s*bibliography$/i.test(trimmed)) {
        inTOC = false; inReferences = true; inGlossary = false;
        elements.push({ type: 'reference', content: trimmed });
        continue;
      }

      // Detect Glossary
      if (/^\d*\.?\s*(glossary|appendix)/i.test(trimmed)) {
        inTOC = false; inReferences = false; inGlossary = true;
        elements.push({ type: 'glossary', content: trimmed });
        continue;
      }

      // Handle TOC entries
      if (inTOC) {
        if (!/^\d+\./.test(trimmed) && /^[A-Z]/.test(trimmed) && trimmed.length > 5) inTOC = false;
        else { elements.push({ type: 'toc', content: trimmed }); continue; }
      }

      // Handle References entries
      if (inReferences) {
        if (!/^\[\d+\]/.test(trimmed) && /^[A-Z]/.test(trimmed)) inReferences = false;
        else { elements.push({ type: 'reference', content: trimmed }); continue; }
      }

      // Handle Glossary entries
      if (inGlossary) {
        if (/^[A-Z]/.test(trimmed) && !/[:–\-]/.test(trimmed)) inGlossary = false;
        else { elements.push({ type: 'glossary', content: trimmed }); continue; }
      }

      // Handle tables - buffer until section boundary
      if (tableBuffer.length > 0) {
        if (/^\d+\.\d+\s+/.test(trimmed) || /^Figure\s+\d+:/i.test(trimmed) || /^[A-Z][A-Z\s]{5,}$/.test(trimmed)) {
          elements.push({ type: 'table', content: tableBuffer.join('\n') });
          tableBuffer = [];
        } else {
          tableBuffer.push(trimmed);
          continue;
        }
      }

      if (/^Table\s+\d+:/i.test(trimmed)) {
        tableBuffer = [trimmed];
        continue;
      }

      // Handle figures
      if (/^Figure\s+\d+:/i.test(trimmed)) {
        const figContent = [trimmed];
        for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
          const nextLine = lines[j].trim();
          if (!nextLine) break;
          if (/^\d+\.\d+/.test(nextLine) || /^Table/.test(nextLine)) break;
          figContent.push(nextLine);
          i = j;
        }
        elements.push({ type: 'figure', content: figContent.join(' ') });
        continue;
      }

      // Add body text
      if (trimmed.length > 2 && !inTOC && !inReferences && !inGlossary && !inCode) {
        bodyLines.push(trimmed);
      }
    }

    if (tableBuffer.length > 0) {
      elements.push({ type: 'table', content: tableBuffer.join('\n') });
    }

    // Add collected body lines
    for (const bodyLine of bodyLines) {
      elements.push({ type: 'body', content: bodyLine });
    }

    return elements;
  }

  private looksLikeHeader(line: string): boolean {
    if (line.length > 100 || line.length < 3) return false;
    return /^(chapter|section|part|[A-Z\s]{5,}|[A-Z][a-z]+\s+\d+)$/i.test(line) ||
           /^[\w\s]+\s{2,}\d+$/.test(line);
  }

  private looksLikeFooter(line: string): boolean {
    if (line.length > 80 || line.length < 1) return false;
    return /^(page\s*\d+|-\s*\d+\s*-|©|www\.|[A-Z\s]{3,}\s+\d+)$/i.test(line) ||
           /^\d+$/.test(line) || /©.*\d{4}/.test(line) || /\.(com|org|edu)/.test(line);
  }

  private looksLikeCode(trimmed: string, line: string): boolean {
    // Check for code indicators: backticks, code block markers, heavy indentation
    if (/```|```javascript|```python|```bash|<code>|{|}|=>|const |function |class /.test(trimmed)) return true;
    if (/^\s{4,}/.test(line) && trimmed.length > 0) return true; // Heavily indented
    if (/^>>>|^\$|^#!|^import |^from |^def |^class /.test(trimmed)) return true; // Python/shell indicators
    return false;
  }
}
