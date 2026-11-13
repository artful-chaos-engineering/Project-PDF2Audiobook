// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  dialogueSegments,
  enforceTurnLength,
  splitLongTurns,
  MAX_TURN_WORDS,
  MIN_TURN_WORDS,
  mergeAdjacentTurns,
  narrationSegments,
  wordCount,
  MIN_TURN_WORDS,
  Turn,
} from './modes';
import { batchDialogue, chunkText, MAX_DIALOGUE_CHARS } from './ttsConverter';

const voices = { speaker1: 'matilda', speaker2: 'mark' };
const words = (n: number, word = 'word') => Array.from({ length: n }, () => word).join(' ') + '.';

test('consecutive turns by one speaker are merged', () => {
  const turns: Turn[] = [
    { speaker: 'A', text: 'First.' },
    { speaker: 'A', text: 'Second.' },
    { speaker: 'B', text: 'Third.' },
  ];
  assert.deepEqual(mergeAdjacentTurns(turns), [
    { speaker: 'A', text: 'First. Second.' },
    { speaker: 'B', text: 'Third.' },
  ]);
});

test('no turn under the minimum survives, and its neighbours join up', () => {
  const turns: Turn[] = [
    { speaker: 'A', text: words(30, 'alpha') },
    { speaker: 'B', text: 'Such as?' },
    { speaker: 'A', text: words(25, 'beta') },
    { speaker: 'B', text: words(22, 'gamma') },
    { speaker: 'A', text: 'Okay.' },
  ];
  const result = enforceTurnLength(turns);
  assert.equal(result.dropped, 2);
  assert.deepEqual(result.turns.map(t => t.speaker), ['A', 'B']);
  assert.ok(result.turns.every(t => wordCount(t.text) >= MIN_TURN_WORDS));
  assert.ok(result.turns[0].text.includes('alpha') && result.turns[0].text.includes('beta'));
  assert.ok(!result.turns.some(t => t.text.includes('Such as?') || t.text.includes('Okay.')));
});

test('a script with only short turns ends up empty', () => {
  const result = enforceTurnLength([{ speaker: 'A', text: 'Yes.' }, { speaker: 'B', text: 'Go ahead.' }]);
  assert.equal(result.turns.length, 0);
  assert.equal(result.dropped, 2);
});

test('every dialogue line keeps the speaker the script gave it', () => {
  const blocks: Turn[][] = [
    [{ speaker: 'A', text: words(25) }, { speaker: 'B', text: words(25) }, { speaker: 'A', text: words(25) }],
    [{ speaker: 'B', text: words(25) }, { speaker: 'A', text: words(25) }],
  ];
  const segments = dialogueSegments(blocks, voices);
  assert.deepEqual(segments.map(s => s.voice), ['matilda', 'mark', 'matilda', 'mark', 'matilda']);
  assert.deepEqual(segments.map(s => s.speaker), ['A', 'B', 'A', 'B', 'A']);
  assert.deepEqual(segments.map(s => s.group), [0, 0, 0, 1, 1]);
});

test('pauses between speakers are short and pauses between sections are longer', () => {
  const blocks: Turn[][] = [[{ speaker: 'A', text: words(25) }, { speaker: 'B', text: words(25) }]];
  for (let run = 0; run < 200; run++) {
    const [first, last] = dialogueSegments(blocks, voices);
    assert.ok(first.pauseAfter >= 0.2 && first.pauseAfter <= 0.6, `speaker change ${first.pauseAfter}`);
    assert.ok(last.pauseAfter >= 0.8 && last.pauseAfter <= 1.8, `section ${last.pauseAfter}`);
  }
});

test('in narration a heading is read by the voice that reads the paragraph after it', () => {
  const sections = [
    `1 First Section Title\n${words(60)}\n\n${words(3)}\n\n${words(70)}`,
    `2 A Second And Rather Longer Section Title For The Test\n${words(4)}\n\n${words(80)}`,
    `3 Third Section\n${words(50)}`,
  ];
  for (let run = 0; run < 200; run++) {
    const segments = narrationSegments(sections, voices);
    segments.forEach((segment, i) => {
      if (/^\d /.test(segment.text)) {
        assert.equal(segment.voice, segments[i + 1].voice, `heading "${segment.text}" switched voice`);
      }
    });
  }
});

test('in narration a short paragraph does not hand over to the other voice', () => {
  const sections = [`${words(60)}\n\n${words(3)}\n\n${words(70)}`];
  for (let run = 0; run < 200; run++) {
    const [long, short, next] = narrationSegments(sections, voices);
    assert.notEqual(long.voice, short.voice);
    assert.equal(short.voice, next.voice);
  }
});

test('dialogue batches stay under the request limit and lose no text', () => {
  const lines = Array.from({ length: 12 }, (_v, i) => ({
    voice: i % 2 === 0 ? 'matilda' : 'mark',
    text: `Turn ${i}. ${words(60, `w${i}`)} ${words(40, `x${i}`)}`,
    pauseAfter: 0.35,
  }));
  const batches = batchDialogue(lines);
  assert.ok(batches.length > 1);
  for (const batch of batches) {
    const size = batch.reduce((sum, line) => sum + line.text.length, 0);
    assert.ok(size <= MAX_DIALOGUE_CHARS, `batch of ${size} characters`);
  }
  const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();
  assert.equal(
    normalise(batches.flat().map(line => line.text).join(' ')),
    normalise(lines.map(line => line.text).join(' ')),
  );
});

test('a turn longer than one request is split at sentence ends and keeps its voice', () => {
  const sentence = `${words(40, 'long')}`;
  const text = Array.from({ length: 12 }, () => sentence).join(' ');
  assert.ok(text.length > MAX_DIALOGUE_CHARS);
  const batches = batchDialogue([{ voice: 'mark', text, pauseAfter: 0.9 }]);
  const pieces = batches.flat();
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every(piece => piece.voice === 'mark'));
  assert.ok(pieces.every(piece => piece.text.endsWith('.')));
  assert.equal(pieces[pieces.length - 1].pauseAfter, 0.9);
  assert.ok(pieces.slice(0, -1).every(piece => piece.pauseAfter < 0.9));
});

test('text after the last full stop is kept', () => {
  assert.deepEqual(chunkText('First sentence. Then a tail with no full stop', 1000), [
    'First sentence. Then a tail with no full stop',
  ]);
});

test('decimals are not split across chunks', () => {
  const chunks = chunkText('The cost is $2.5 million. The median is 1.16 million.', 30);
  assert.deepEqual(chunks, ['The cost is $2.5 million.', 'The median is 1.16 million.']);
});

test('no turn is longer than the maximum, and a split keeps every word in order', () => {
  const long = Array.from({ length: 12 }, (_v, i) => `Sentence ${i} has exactly eleven words in it here.`).join(' ');
  const parts = splitLongTurns([{ speaker: 'A', text: long }]);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(p => p.speaker === 'A' && wordCount(p.text) <= MAX_TURN_WORDS));
  assert.equal(parts.map(p => p.text).join(' '), long);
});

test('a split never leaves a fragment under the minimum', () => {
  const pieces = Array.from({ length: 4 }, () => 'Each sentence here carries exactly twenty six words, so the splitter must weigh every one of them carefully and keep the rest of the story together for the listener right now.').join(' ');
  const parts = splitLongTurns([{ speaker: 'B', text: pieces + ' Short tail of five.' }]);
  assert.ok(parts.every(p => wordCount(p.text) >= MIN_TURN_WORDS || parts.length === 1));
  assert.equal(parts.map(p => p.text).join(' '), pieces + ' Short tail of five.');
});
