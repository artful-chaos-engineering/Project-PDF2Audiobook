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
    const lines = content.split('\n').filter(l => l.trim().length > 2);

    if (lines.length < 2) return 'a data table';

    // Get header line (usually first line)
    const headerLine = lines[0].toLowerCase();
    const dataLines = lines.slice(1, 5);

    // Count actual columns (split by multiple spaces or tabs)
    const columnCount = (lines[0].match(/\s{2,}|\t/g) || []).length + 1;

    // Detect content type
    const hasPercentages = /\d+%/.test(content);
    const hasVeryHighNumbers = /\d{4,}/.test(content);
    const firstDataLine = dataLines[0] || '';

    // Generate specific summary
    let summary = '';

    if (hasPercentages) {
      summary = `a comparison table with ${Math.max(2, columnCount)} columns showing percentage data.`;
    } else if (hasVeryHighNumbers) {
      summary = `a data table with ${Math.max(2, columnCount)} columns containing numerical statistics.`;
    } else if (headerLine.includes('algorithm') || headerLine.includes('method')) {
      summary = `a comparison table evaluating different algorithms or methods across multiple metrics.`;
    } else if (columnCount > 3) {
      summary = `a comprehensive data table with ${columnCount} columns containing various measurements.`;
    } else {
      summary = `a data table with ${Math.max(2, columnCount)} columns of structured information.`;
    }

    return summary;
  }

  private summarizeFigure(content: string, pageNum: number): string {
    // Clean up the content (remove "Figure X:" prefix)
    let text = content.replace(/^[Ff]igure\s+\d+[:\s]+/i, '').trim();

    // If still starts with "Figure X:" or numbers, skip that
    text = text.replace(/^\d+[:\s]+/, '').trim();

    if (!text) return 'a diagram illustrating the concept';

    // Generate 1-3 sentence summary based on content
    if (text.length > 200) {
      return text.slice(0, 150).trim() + '...';
    } else if (text.includes('show') || text.includes('display')) {
      return text.slice(0, 180);
    } else if (text.length > 80) {
      return text;
    } else {
      return text + ' This visualization illustrates key concepts from the material.';
    }
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
