import pdfParse from 'pdf-parse';
import * as fs from 'fs';
import type { ExtractedContent, Page, ContentElement } from './types';

export class PDFExtractor {
  async extractFromFile(pdfPath: string): Promise<ExtractedContent> {
    const fileBuffer = fs.readFileSync(pdfPath);
    const pdf = await pdfParse(fileBuffer);

    const pages: Page[] = pdf.pages.map((pageText: string, index: number) => ({
      pageNumber: index + 1,
      text: pageText,
      elements: this.identifyElements(pageText, index + 1),
    }));

    return {
      pages,
      metadata: {
        title: pdf.info?.Title,
        author: pdf.info?.Author,
        pageCount: pdf.numPages,
      },
    };
  }

  private identifyElements(text: string, pageNum: number): ContentElement[] {
    const elements: ContentElement[] = [];
    const lines = text.split('\n');

    let currentElement: ContentElement | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect element type
      if (this.isHeader(trimmed, pageNum)) {
        this.flushElement(elements, currentElement);
        currentElement = { type: 'header', content: trimmed };
      } else if (this.isFooter(trimmed, pageNum)) {
        this.flushElement(elements, currentElement);
        currentElement = { type: 'footer', content: trimmed };
      } else if (this.isTableOfContents(trimmed)) {
        this.flushElement(elements, currentElement);
        elements.push({ type: 'toc', content: trimmed });
        currentElement = null;
      } else if (this.isTableContent(trimmed)) {
        this.flushElement(elements, currentElement);
        if (currentElement?.type !== 'table') {
          currentElement = { type: 'table', content: trimmed };
        } else {
          currentElement.content += '\n' + trimmed;
        }
      } else if (this.isFigureCaption(trimmed)) {
        this.flushElement(elements, currentElement);
        currentElement = { type: 'figure', content: trimmed };
      } else if (this.isReference(trimmed)) {
        this.flushElement(elements, currentElement);
        elements.push({ type: 'reference', content: trimmed });
        currentElement = null;
      } else if (this.isGlossary(trimmed)) {
        this.flushElement(elements, currentElement);
        elements.push({ type: 'glossary', content: trimmed });
        currentElement = null;
      } else if (this.isHeading(trimmed)) {
        this.flushElement(elements, currentElement);
        const level = this.getHeadingLevel(trimmed);
        currentElement = { type: 'heading', content: trimmed, level };
      } else {
        if (!currentElement || currentElement.type !== 'body') {
          this.flushElement(elements, currentElement);
          currentElement = { type: 'body', content: trimmed };
        } else {
          currentElement.content += '\n' + trimmed;
        }
      }
    }

    this.flushElement(elements, currentElement);
    return elements;
  }

  private flushElement(elements: ContentElement[], element: ContentElement | null) {
    if (element && element.content.trim()) {
      elements.push(element);
    }
  }

  private isHeader(text: string, pageNum: number): boolean {
    // Headers: running text at top of pages
    const trimmed = text.trim();
    return (
      trimmed.length < 100 &&
      (/^(chapter|part|section)\s+\d+/i.test(trimmed) ||
        /^[\w\s]+\s{2,}\d+$/.test(trimmed) ||
        /^[A-Z\s]{3,50}$/.test(trimmed))
    );
  }

  private isFooter(text: string, pageNum: number): boolean {
    // Footers: page numbers, publication info
    const trimmed = text.trim();
    return (
      trimmed.length < 80 &&
      (/^page\s*\d+/i.test(trimmed) ||
        /^-?\s*\d+\s*-?$/.test(trimmed) ||
        /©.*\d{4}/.test(trimmed) ||
        /www\.|\.com|\.org/.test(trimmed))
    );
  }

  private isTableOfContents(text: string): boolean {
    const trimmed = text.trim();
    return /^(table\s*of\s*contents|contents|toc|table of contents)/i.test(
      trimmed
    );
  }

  private isTableContent(text: string): boolean {
    // Tables have multiple columns separated by whitespace or look like data
    const trimmed = text.trim();
    if (trimmed.length < 20) return false;

    // Multiple columns with consistent spacing
    const columnCount = (trimmed.match(/\s{2,}/g) || []).length;
    if (columnCount > 1) return true;

    // Lines that look like table rows (alternating text and numbers)
    return /[\w\s]+\s+\d+[\s\d,]+$/.test(trimmed);
  }

  private isFigureCaption(text: string): boolean {
    return /^(figure|fig\.?)\s+(\d+(?:\.\d+)?)[:\s]/i.test(text.trim());
  }

  private isReference(text: string): boolean {
    const trimmed = text.trim();
    return (
      /^(references?|bibliography|works\s*cited|citations?)/i.test(trimmed) ||
      /^\[[\d\w]+\]\s+(.*)?$/.test(trimmed)
    );
  }

  private isGlossary(text: string): boolean {
    const trimmed = text.trim();
    return (
      /^(glossary|appendices?|appendix|definitions?|index)/i.test(trimmed)
    );
  }

  private isHeading(text: string): boolean {
    // Multi-word uppercase text or clear heading patterns
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 150) return false;

    return (
      /^[A-Z][A-Z\s]{3,}$/.test(trimmed) ||
      /^\d+\.\s+[A-Z].+/.test(trimmed) ||
      /^#{1,6}\s+.+/i.test(trimmed)
    );
  }

  private getHeadingLevel(text: string): number {
    const trimmed = text.trim();

    // Check for markdown style headings
    const hashCount = (trimmed.match(/^#+/)?.[0] || '').length;
    if (hashCount > 0) return Math.min(hashCount, 6);

    // Check for numbered outline
    const numberMatch = trimmed.match(/^(\d+)\./);
    if (numberMatch) {
      return Math.min(numberMatch[1].split('.').length, 3);
    }

    // Heuristic: shorter headings are higher level
    if (trimmed.length < 30) return 1;
    if (trimmed.length < 60) return 2;
    return 3;
  }
}
