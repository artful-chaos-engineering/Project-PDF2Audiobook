import * as pdfParse from 'pdf-parse';
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
    // Headers typically appear at the top of pages with small fonts
    // Check for common header patterns
    return text.length < 80 && (text.includes('Chapter') || /^\d+\./.test(text));
  }

  private isFooter(text: string, pageNum: number): boolean {
    // Footers often contain page numbers or are repeated at bottom
    return text.length < 50 && (/^\d+$/.test(text) || text.match(/page\s*\d+/i));
  }

  private isTableOfContents(text: string): boolean {
    return /^(table\s*of\s*contents|toc|contents)/i.test(text);
  }

  private isTableContent(text: string): boolean {
    // Detect table rows - typically multiple columns separated by spaces or tabs
    return /^\s*[\w\s]*\s{2,}[\w\s]*/.test(text) && !text.includes('\n');
  }

  private isFigureCaption(text: string): boolean {
    return /^(figure|fig\.?)\s+\d+/i.test(text);
  }

  private isReference(text: string): boolean {
    return /^(references?|bibliography|works\s*cited)/i.test(text);
  }

  private isGlossary(text: string): boolean {
    return /^(glossary|appendix|definitions?)/i.test(text);
  }

  private isHeading(text: string): boolean {
    // Detect common heading patterns
    return /^[A-Z][A-Z\s]*$/.test(text) && text.length > 3 && text.length < 100;
  }

  private getHeadingLevel(text: string): number {
    // Simple heuristic: longer headings are lower level
    if (text.length < 30) return 1;
    if (text.length < 60) return 2;
    return 3;
  }
}
