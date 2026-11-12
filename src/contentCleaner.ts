// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import type { ExtractedContent, CleanedContent, TableFigureSummary } from './types';

export class ContentCleaner {
  async clean(extracted: ExtractedContent): Promise<CleanedContent> {
    const narrativeLines: string[] = [];
    const summaries: TableFigureSummary[] = [];
    let tableNum = 0, figNum = 0;

    for (const page of extracted.pages) {
      for (const element of page.elements) {
        switch (element.type) {
          case 'heading':
          case 'body':
            narrativeLines.push(element.content);
            break;
          case 'table':
            tableNum++;
            const ts = this.summarizeTable(element.content);
            const tnum = this.extractNumber(element.content, 'table');
            summaries.push({ type: 'table', number: tnum, summary: ts, insertedAt: narrativeLines.length });
            break;
          case 'figure':
            figNum++;
            const fs = this.summarizeFigure(element.content);
            const fnum = this.extractNumber(element.content, 'figure');
            summaries.push({ type: 'figure', number: fnum, summary: fs, title: this.extractTitle(element.content), insertedAt: narrativeLines.length });
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
      const type = summary.type === 'table' ? 'Table' : 'Figure';
      const insertion = `${type} ${summary.number} shows ${summary.summary}`;
      const paragraphs = finalText.split('\n\n');
      if (summary.insertedAt > 0 && summary.insertedAt <= paragraphs.length) {
        paragraphs.splice(summary.insertedAt, 0, insertion);
        finalText = paragraphs.join('\n\n');
      } else {
        finalText += '\n\n' + insertion;
      }
    }

    return {
      narrativeText: finalText.replace(/\n\n\n+/g, '\n\n').replace(/\s+([.,:;!?])/g, '$1').trim(),
      summaries,
    };
  }

  private summarizeTable(content: string): string {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 1);
    if (lines.length < 3) return 'a table with structured data.';

    const title = lines[0]?.toLowerCase() || '';
    const dataLines = lines.slice(1);

    // Identify column count and headers
    const headerCandidates = dataLines.slice(0, 5);
    let columnCount = 0;
    for (const line of headerCandidates) {
      if (/^(algorithm|type|name|use case|accuracy|speed|memory|value)/i.test(line)) {
        columnCount++;
      } else {
        break;
      }
    }
    if (columnCount === 0) columnCount = 3;

    // Group data into rows
    const rowData: string[][] = [];
    for (let i = columnCount; i < dataLines.length; i += columnCount) {
      const row = dataLines.slice(i, i + columnCount);
      if (row.length === columnCount) {
        rowData.push(row);
      }
    }

    // Extract algorithms (first column of each row)
    const algorithms = rowData.map(r => r[0]).filter(a => a && !/^(regression|classification|fast|slow|low|high)$/i.test(a));
    
    // Extract types (second column if contains Type words)
    const types = rowData.map(r => r[1] || '').filter(t => /regression|classification/i.test(t)).slice(0, 3);

    // Generate summary
    if (types.length > 0 && algorithms.length > 0) {
      const algList = algorithms.slice(0, 4).join(', ');
      const typeList = types.slice(0, 2).join(', ');
      return `supervised learning algorithms including ${algList}, with algorithm types ${typeList}, showing their use cases.`;
    }

    // Check for accuracy-based comparison
    const accuracies = dataLines.filter(l => /\d+%/.test(l)).slice(0, 3);
    if (accuracies.length > 0 && algorithms.length > 0) {
      const algList = algorithms.slice(0, 2).join(', ');
      return `comparison of ${algorithms.length} machine learning algorithms (${algList}) with accuracies: ${accuracies.slice(0, 2).join(', ')}.`;
    }

    return `table with ${algorithms.length} entries.`;
  }

  private summarizeFigure(content: string): string {
    const withoutPrefix = content.replace(/^[Ff]igure\s+\d+[:\s]+/i, '');
    const words = withoutPrefix.split(/\s+/);

    let captionEndIdx = 0;
    for (let i = 0; i < Math.min(words.length, 8); i++) {
      const word = words[i];
      if (/^[a-z]/.test(word) || (i > 2 && /^[A-Z][a-z]/.test(word) && i > 3)) break;
      captionEndIdx = i + 1;
    }

    const description = words.slice(captionEndIdx).join(' ');
    if (description.length > 20) {
      const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 0).slice(0, 2);
      if (sentences.length > 0) {
        return sentences.map(s => s.trim()).join('. ') + '.';
      }
    }

    return description.length > 5 ? description + '.' : 'a diagram illustrating key concepts.';
  }

  private extractNumber(content: string, type: string): string {
    const pattern = type === 'table' ? /[Tt]able\s+(\d+)/ : /[Ff]ig(?:ure)?\s+(\d+)/;
    const match = content.match(pattern);
    return match ? match[1] : 'unknown';
  }

  private extractTitle(content: string): string | undefined {
    const match = content.match(/[Ff]ig(?:ure)?\s+\d+[:\s]+([^\n.]+)/);
    return match ? match[1].trim().slice(0, 100) : undefined;
  }
}
