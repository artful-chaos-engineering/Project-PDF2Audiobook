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
            break;
        }
      }
    }

    let finalText = narrativeLines.join('\n\n');

    for (const summary of summaries) {
      const insertion = this.formatSummaryInsertion(summary);
      finalText = this.insertSummary(finalText, insertion, summary.insertedAt);
    }

    return {
      narrativeText: this.cleanupText(finalText),
      summaries,
    };
  }

  private summarizeTable(content: string, pageNum: number): string {
    const lines = content.split('\n').filter(l => l.trim().length > 2);

    if (lines.length < 2) {
      return `a reference table with key data`;
    }

    const titleMatch = content.match(/^[Tt]able\s+\d+[:\s]+(.+?)(?:\n|$)/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const fullContent = content.toLowerCase();
    const hasPercentages = /\d+%/.test(content);
    const hasAlgorithms = /algorithm|method|model|tree|forest|network|regression/i.test(content);
    const hasMetrics = /accuracy|speed|memory|performance|complexity|time/i.test(content);
    
    const dataLines = lines.slice(1);
    const rowCount = Math.max(2, dataLines.length);

    if (hasAlgorithms && hasMetrics) {
      return `a comparison of ${rowCount} algorithms with performance metrics including accuracy, speed, and memory usage`;
    } else if (title.toLowerCase().includes('comparison')) {
      return `a comparison table with ${rowCount} entries evaluated across multiple dimensions`;
    } else if (hasPercentages) {
      return `a data table with percentages and statistics across ${rowCount} categories`;
    } else if (hasMetrics) {
      return `a metrics table showing performance indicators for ${rowCount} items`;
    } else if (rowCount > 5) {
      return `a reference table containing ${rowCount} entries of structured data`;
    } else {
      return `a ${rowCount}-row table organizing related data for easy reference`;
    }
  }

  private summarizeFigure(content: string, pageNum: number): string {
    let caption = content.replace(/^[Ff]igure\s+\d+[:\s]+/i, '').trim();
    caption = caption.replace(/^\d+[:\s]+/, '').trim();

    if (!caption || caption.length < 3) {
      return `a diagram illustrating key concepts`;
    }

    return caption;
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
    const match = content.match(/(?:[Ff]ig(?:ure)?|Fig\.?)\s+\d+[:\s]+(.+)/);
    if (match) {
      const title = match[1].trim();
      const cleanTitle = title.replace(/^\d+[:\s]+/, '');
      return cleanTitle.length > 0 ? cleanTitle.slice(0, 100) : undefined;
    }
    return undefined;
  }

  private formatSummaryInsertion(summary: TableFigureSummary): string {
    const type = summary.type === 'table' ? 'Table' : 'Figure';
    return `${type} ${summary.number} shows ${summary.summary}.`;
  }

  private insertSummary(text: string, insertion: string, position: number): string {
    const paragraphs = text.split('\n\n');

    if (position > 0 && position <= paragraphs.length) {
      paragraphs.splice(position, 0, insertion);
      return paragraphs.join('\n\n');
    }

    return text + '\n\n' + insertion;
  }

  private cleanupText(text: string): string {
    return text
      .replace(/\n\n\n+/g, '\n\n')
      .replace(/\s+([.,:;!?])/g, '$1')
      .trim();
  }
}
