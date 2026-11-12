// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

export interface ExtractedContent {
  pages: Page[];
  metadata: {
    title?: string;
    author?: string;
    pageCount: number;
  };
}

export interface Page {
  pageNumber: number;
  text: string;
  elements: ContentElement[];
}

export interface ContentElement {
  type: 'heading' | 'body' | 'table' | 'figure' | 'reference' | 'toc' | 'glossary' | 'header' | 'footer';
  content: string;
  level?: number;
}

export interface CleanedContent {
  narrativeText: string;
  summaries: TableFigureSummary[];
}

export interface TableFigureSummary {
  type: 'table' | 'figure';
  number: string;
  title?: string;
  summary: string;
  insertedAt: number; // position in narrative text to insert summary
}

export interface AudioSegment {
  text: string;
  audio: Buffer;
  duration: number;
  voice?: string;
}

export interface AudiobookConfig {
  pdfPath: string;
  outputPath: string;
  voiceProvider: 'elevenlabs' | 'google' | 'azure' | 'mac';
  voice?: string;
  language?: string;
  speed?: number;
}
