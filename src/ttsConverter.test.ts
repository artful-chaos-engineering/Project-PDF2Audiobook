// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { applyGains, keptRanges, matchingGains, spansOf, takeCanBeOneRequest, voiceSettingsFor } from './ttsConverter';
import { DEFAULT_TUNING } from './voiceSettings';

const RATE = 44100;

function clip(layout: [seconds: number, amplitude: number][]): Int16Array {
  const total = layout.reduce((sum, [seconds]) => sum + Math.round(seconds * RATE), 0);
  const samples = new Int16Array(total);
  let at = 0;
  for (const [seconds, amplitude] of layout) {
    const length = Math.round(seconds * RATE);
    for (let i = 0; i < length; i++) samples[at + i] = i % 2 === 0 ? amplitude : -amplitude;
    at += length;
  }
  return samples;
}

test('silence at both ends of a clip is trimmed, keeping a short margin', () => {
  const samples = clip([[0.5, 0], [1.0, 8000], [0.4, 0]]);
  const [span] = spansOf([{ group: 'mark', start: 0, end: Number.MAX_SAFE_INTEGER }], samples);
  assert.ok(Math.abs(span.from / RATE - 0.47) < 0.005, `starts at ${span.from / RATE}s`);
  assert.ok(Math.abs(span.to / RATE - 1.53) < 0.005, `ends at ${span.to / RATE}s`);
});

test('splitting a take by voice covers it end to end with no gap', () => {
  const samples = clip([[0.2, 0], [1.0, 8000], [0.3, 0], [1.5, 6000], [0.2, 0]]);
  const spans = spansOf([
    { group: 'matilda', start: 0, end: 1.35 },
    { group: 'mark', start: 1.35, end: 3.0 },
  ], samples);
  assert.deepEqual(spans.map(s => s.group), ['matilda', 'mark']);
  assert.equal(spans[0].to, spans[1].from);
  assert.equal(spans[0].to, Math.round(1.35 * RATE));
  assert.ok(spans[1].to / RATE > 2.99);
});

test('a clip of pure silence yields nothing to play', () => {
  assert.deepEqual(spansOf([{ group: 'mark', start: 0, end: 5 }], clip([[1.0, 0]])), []);
});

test('both voices are brought to the same loudness', () => {
  const gains = matchingGains(new Map([
    ['matilda', { loudness: -22.3, peakDb: -9 }],
    ['mark', { loudness: -20.1, peakDb: -8 }],
  ]));
  assert.ok(Math.abs((-22.3 + gains.get('matilda')!) - (-20.1 + gains.get('mark')!)) < 1e-9);
  assert.ok(Math.abs(-22.3 + gains.get('matilda')! - -18) < 1e-9);
});

test('a voice with little headroom lowers the common level and nothing clips', () => {
  const measured = new Map([
    ['matilda', { loudness: -22.0, peakDb: -1.5 }],
    ['mark', { loudness: -20.0, peakDb: -6 }],
  ]);
  const gains = matchingGains(measured);
  for (const [group, { loudness, peakDb }] of measured) {
    assert.ok(peakDb + gains.get(group)! <= -1 + 1e-9, `${group} would clip`);
    assert.ok(Math.abs(loudness + gains.get(group)! - -21.5) < 1e-9, `${group} is off the common level`);
  }
});

test('the level changes smoothly where one voice hands over to the other', () => {
  const samples = new Int16Array(RATE).fill(10000);
  const half = RATE / 2;
  applyGains(samples, [
    { group: 'matilda', from: 0, to: half },
    { group: 'mark', from: half, to: RATE },
  ], new Map([['matilda', 0], ['mark', -6]]));
  assert.equal(samples[0], 10000);
  assert.equal(samples[RATE - 1], Math.round(10000 * Math.pow(10, -6 / 20)));
  let largestStep = 0;
  for (let i = 1; i < RATE; i++) largestStep = Math.max(largestStep, Math.abs(samples[i] - samples[i - 1]));
  assert.ok(largestStep < 20, `step of ${largestStep}`);
});

test('a long silence inside a clip is shortened to the limit and speech is untouched', () => {
  const samples = clip([[1.0, 8000], [1.4, 0], [1.0, 6000], [0.3, 0], [0.5, 7000]]);
  const limit = Math.round(0.55 * RATE);
  const ranges = keptRanges(samples, 0, samples.length, limit);
  const kept = ranges.reduce((sum, r) => sum + (r.to - r.from), 0);
  assert.equal(ranges.length, 2);
  assert.equal(samples.length - kept, Math.round(1.4 * RATE) - limit);
  const loud = (r: { from: number; to: number }) => {
    let count = 0;
    for (let i = r.from; i < r.to; i++) if (samples[i] !== 0) count++;
    return count;
  };
  assert.equal(ranges.reduce((sum, r) => sum + loud(r), 0), Math.round(1.0 * RATE) * 2 + Math.round(0.5 * RATE));
});

test('a clip with no long silence is kept whole', () => {
  const samples = clip([[1.0, 8000], [0.4, 0], [1.0, 6000]]);
  assert.deepEqual(keptRanges(samples, 0, samples.length, Math.round(0.55 * RATE)), [{ from: 0, to: samples.length }]);
});

test('a two-voice exchange is one take only when both voices share their settings', () => {
  const same = { matilda: DEFAULT_TUNING, mark: DEFAULT_TUNING };
  const different = { matilda: DEFAULT_TUNING, mark: { ...DEFAULT_TUNING, stability: 0.3 } };
  assert.equal(takeCanBeOneRequest(['matilda', 'mark', 'matilda'], same), true);
  assert.equal(takeCanBeOneRequest(['matilda', 'mark'], different), false);
  assert.equal(takeCanBeOneRequest(['matilda', 'matilda'], different), true);
});

test('models without speed and style control receive only the settings they accept', () => {
  const v4 = voiceSettingsFor('eleven_v4', { ...DEFAULT_TUNING, style: 0.4, speed: 1.1 });
  assert.deepEqual(Object.keys(v4).sort(), ['clone_strength', 'similarity_boost', 'stability', 'use_speaker_boost']);
  const flash = voiceSettingsFor('eleven_flash_v2_5', { ...DEFAULT_TUNING, style: 0.4, speed: 1.1 });
  assert.equal(flash.style, 0.4);
  assert.equal(flash.speed, 1.1);
});
