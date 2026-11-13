// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PREVIEW_CASES } from './previewCases';

const sentences = (text: string) => text.split(/[.!?]+(?=\s|$)/).map(s => s.trim()).filter(Boolean).length;

test('there are ten preview cases', () => {
  assert.equal(PREVIEW_CASES.length, 10);
});

test('every preview case has between 5 and 10 sentences', () => {
  for (const c of PREVIEW_CASES) {
    const n = sentences(c.text);
    assert.ok(n >= 5 && n <= 10, `"${c.name}" has ${n} sentences`);
  }
});
