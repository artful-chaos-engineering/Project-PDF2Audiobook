import type { ExtractedContent, CleanedContent, TableFigureSummary, Page } from './types';

export class ContentCleaner {
  async clean(extracted: ExtractedContent): Promise<CleanedContent> {
    const narrativeLines: string[] = [];
    const summaries: TableFigureSummary[] = [];
    let insertPosition = 0;

    for (const page of extracted.pages) {
      for (const element of page.elements) {
        switch (element.type) {
          case 'heading':
          case 'body':
            // Keep narrative content
            narrativeLines.push(element.content);
            insertPosition = narrativeLines.length;
            break;

          case 'table':
            const tableSummary = this.summarizeTable(element.content, page.pageNumber);
            summaries.push({
              type: 'table',
              number: this.extractTableNumber(element.content),
              summary: tableSummary,
              insertedAt: insertPosition,
            });
            break;

          case 'figure':
            const figureSummary = this.summarizeFigure(element.content, page.pageNumber);
            summaries.push({
              type: 'figure',
              number: this.extractFigureNumber(element.content),
              title: this.extractFigureTitle(element.content),
              summary: figureSummary,
              insertedAt: insertPosition,
            });
            break;

          case 'header':
          case 'footer':
          case 'toc':
          case 'reference':
          case 'glossary':
            // Skip non-narrative content
            break;
        }
      }
    }

    // Build final narrative with table/figure summaries inserted
    let finalText = narrativeLines.join('\n\n');

    // Insert summaries at appropriate positions
    for (const summary of summaries) {
      const insertion = this.formatSummaryInsertion(summary);
      // Insert near the position it was encountered
      finalText = this.insertSummary(finalText, insertion, summary.insertedAt);
    }

    return {
      narrativeText: this.cleanupText(finalText),
      summaries,
    };
  }

  private summarizeTable(content: string, pageNum: number): string {
    // Extract key information from table
    const lines = content.split('\n').filter(l => l.trim().length > 0).slice(0, 10);
    const headers = this.extractTableHeaders(content);

    if (headers.length > 0) {
      const headerList = headers.slice(0, 4).join(', ');
      return `a data table with ${headers.length} columns${headers.length > 4 ? ` including: ${headerList}` : ': ' + headerList}`;
    }

    // Try to infer table contents from text patterns
    const hasNumericData = /\d+([,.]?\d+)?/.test(content);
    const hasPercentages = /%/.test(content);

    if (hasNumericData && hasPercentages) {
      return 'a statistical data table with percentages';
    } else if (hasNumericData) {
      return 'a numerical data table';
    }

    return 'a data table';
  }

  private summarizeFigure(content: string, pageNum: number): string {
    // Extract figure caption or description
    const captionMatch = content.match(/(?:caption|figure|fig\.?)[:\s]+(.+?)(?:\n|$)/i);
    if (captionMatch) {
      const summary = captionMatch[1].trim();
      return summary.length > 150 ? summary.slice(0, 147) + '...' : summary;
    }

    // Look for descriptive text
    const descMatch = content.match(/shows?[:\s]+(.+?)(?:\n|$)/i);
    if (descMatch) {
      return descMatch[1].trim().slice(0, 150);
    }

    return 'a diagram or illustration';
  }

  private extractTableNumber(content: string): string {
    const match = content.match(/[Tt]able\s+(\d+(?:\.\d+)?)/);
    return match ? match[1] : 'unknown';
  }

  private extractFigureNumber(content: string): string {
    const match = content.match(/[Ff]ig(?:ure)?\s+(\d+(?:\.\d+)?)/);
    return match ? match[1] : 'unknown';
  }

  private extractFigureTitle(content: string): string | undefined {
    // Extract the part after "Figure X:" - avoid capturing the number
    const match = content.match(/(?:[Ff]ig(?:ure)?|Fig\.?)\s+\d+[:\s]+(.+)/);
    if (match) {
      const title = match[1].trim();
      // Remove leading numbers like "1: " that might have been captured
      const cleanTitle = title.replace(/^\d+[:\s]+/, '');
      return cleanTitle.length > 0 ? cleanTitle.slice(0, 100) : undefined;
    }
    return undefined;
  }

  private extractTableHeaders(content: string): string[] {
    const lines = content.split('\n');
    if (lines.length === 0) return [];

    // First line often contains headers
    const firstLine = lines[0];
    return firstLine
      .split(/\s{2,}|\t/) // Split by multiple spaces or tabs
      .map(h => h.trim())
      .filter(h => h.length > 0 && !h.match(/^\d+$/))
      .slice(0, 5);
  }

  private formatSummaryInsertion(summary: TableFigureSummary): string {
    const type = summary.type === 'table' ? 'Table' : 'Figure';
    return `${type} ${summary.number} ${summary.type === 'figure' && summary.title ? `titled "${summary.title}" ` : ''}shows ${summary.summary}.`;
  }

  private insertSummary(text: string, insertion: string, position: number): string {
    // Find a good insertion point near where the element was encountered
    // For now, we'll insert after the first paragraph that mentions it
    const paragraphs = text.split('\n\n');

    if (position > 0 && position <= paragraphs.length) {
      paragraphs.splice(position, 0, insertion);
      return paragraphs.join('\n\n');
    }

    return text + '\n\n' + insertion;
  }

  private cleanupText(text: string): string {
    return (
      text
        // Remove excessive whitespace
        .replace(/\n\n\n+/g, '\n\n')
        // Clean up spacing around punctuation
        .replace(/\s+([.,:;!?])/g, '$1')
        // Remove orphaned characters
        .replace(/\b[a-z]\b/g, '')
        .trim()
    );
  }
}
