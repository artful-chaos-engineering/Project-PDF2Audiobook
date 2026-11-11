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
            const tableSummary = this.summarizeTable(element.content);
            summaries.push({
              type: 'table',
              number: this.extractTableNumber(element.content),
              summary: tableSummary,
              insertedAt: insertPosition,
            });
            break;

          case 'figure':
            const figureSummary = this.summarizeFigure(element.content);
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

  private summarizeTable(content: string): string {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return `a reference table`;

    const titleLine = lines[0];
    const title = titleLine.replace(/^Table\s+\d+[:\s]+/i, '').trim();

    // Find header row (contains Algorithm, Type, Accuracy, etc.)
    let headerRowIndex = -1;
    for (let i = 1; i < Math.min(6, lines.length); i++) {
      if (/algorithm|type|accuracy|speed|memory|use case/i.test(lines[i])) {
        headerRowIndex = i;
        break;
      }
    }

    // Count algorithm names (Algo names typically: Decision, Random, Neural, Linear, Logistic, SVM, etc.)
    let algoCount = 0;
    const algoPattern = /^(decision|random|neural|linear|logistic|svm|tree|forest|network|regression|gradient|naive|support vector)/i;
    for (let i = (headerRowIndex > 0 ? headerRowIndex + 1 : 1); i < lines.length; i++) {
      if (algoPattern.test(lines[i])) {
        algoCount++;
      }
    }
    if (algoCount === 0) algoCount = Math.max(2, lines.length - 2);

    // Determine table type
    const fullContent = content.toLowerCase();
    const hasPercentages = /\d+%/.test(content);
    const hasAlgorithms = /algorithm|regression|decision|forest|network/i.test(content);
    const hasMetrics = /accuracy|speed|memory/i.test(content);
    const hasTypes = /type|classification|prediction/i.test(content);

    if (hasAlgorithms && hasMetrics) {
      return `a comparison of ${algoCount} machine learning algorithms showing accuracy, speed, and memory performance`;
    } else if (hasAlgorithms && hasTypes) {
      return `a table comparing ${algoCount} algorithms with their type and use case`;
    } else if (hasPercentages) {
      return `a data table with ${algoCount} rows showing percentages`;
    } else {
      return `a ${algoCount}-row comparison table`;
    }
  }

  private summarizeFigure(content: string): string {
    const parts = content.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
    
    if (parts.length === 0) return `a diagram`;
    
    // Remove "Figure N:" prefix from first part
    let caption = parts[0].replace(/^Figure\s+\d+[:\s]+/i, '').trim();
    
    // If there are description lines (parts[1], parts[2], etc.), combine them as the description
    if (parts.length > 1) {
      const description = parts.slice(1).join(' ').trim();
      return `${caption} ${description}`;
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
    const match = content.match(/(?:[Ff]ig(?:ure)?|Fig\.?)\s+\d+[:\s]+([^\n]+)/);
    return match ? match[1].trim().slice(0, 100) : undefined;
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
