// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import type { Mode } from './modes';

export const STANDARD_INTROS: Record<Mode, string> = {
  narration: 'Welcome. This is an audiobook version of the document. The text is read in order, section by section, and the original wording is kept as closely as possible.',
  podcast: 'Welcome to the show. Today we work through a document together, one section at a time, and pull out the ideas that matter most.',
  debate: 'Welcome to the debate. One side makes the case in this document, and the other side pushes back. Listen for where the arguments hold up and where they do not.',
  summary: 'Welcome. This is a short spoken summary of the document. It covers the main points of each section, so you can take in the key ideas in a fraction of the time.',
  'technical-podcast': 'Welcome to the technical briefing. Today we walk through the engineering ideas in this document, including the mechanisms, the terms and the numbers, one section at a time.',
  'technical-debate': 'Welcome to the technical debate. One speaker defends the engineering claims in this document, and the other tests them, asking where the evidence is thin and what could go wrong.',
  'technical-deep-dive': 'Welcome to the technical deep dive. We go through this document slowly, section by section, explaining each idea in full, how it works and why it matters for the engineering.',
  'technical-summary': 'Welcome to the technical summary. This is a concise spoken overview of the engineering content in this document, with the key mechanisms, figures and conclusions for each section.',
  'managerial-podcast': 'Welcome to the management briefing. Today we look at what this document means for decisions, costs, risks and the people who have to act on it, one section at a time.',
  'managerial-debate': 'Welcome to the management debate. One speaker argues for the course of action this document recommends, and the other asks what it will cost, what could go wrong and whether it is worth the risk.',
  'managerial-deep-dive': 'Welcome to the management deep dive. We go through this document section by section, explaining the decisions it raises, the costs and benefits it describes, and what a manager should do next.',
  'managerial-summary': 'Welcome to the management summary. This is a short spoken overview of what this document means for decisions, costs and risks, with the actions it recommends for each section.',
};
