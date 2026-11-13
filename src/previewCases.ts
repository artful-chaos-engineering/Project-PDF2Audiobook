// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

export interface PreviewCase {
  name: string;
  text: string;
}

export const PREVIEW_CASES: PreviewCase[] = [
  { name: 'Plain sentences', text: 'The quick brown fox jumps over the lazy dog. It is a simple line, but it contains every letter of the alphabet. Read it at a calm, even pace. Notice how the voice handles the commas. Now pause briefly before the final point. This is the end of the test.' },
  { name: 'Questions and emphasis', text: 'Did you really mean that? I thought we agreed on the plan. No, I absolutely do not agree with it! Why would anyone change the schedule now? Stop and think about the cost. Are we sure the budget can cover it? Let us review it together tomorrow.' },
  { name: 'Numbers and currency', text: 'The program costs $2.5 million over 3 years. The margin of error is 12%. The team has about 1,400 engineers across 7 sites. Each site ships a release every 6 weeks. In 2026 the budget rose by 18.5%. The final review is on 14 March at 9:30.' },
  { name: 'Acronyms and product names', text: 'SysML, CISML, and PDF files need an API key from ElevenLabs. The MBSE team uses SysML v2 for every model. Each MP3 file is exported at 128 kilobits per second. Our build runs the JSON and YAML checks on every commit. The web page calls the REST endpoint over HTTPS. Send the PDF to the OCR service first. Then convert the output to speech.' },
  { name: 'Names and foreign words', text: 'Schrödinger, Nguyen, and Søren met for coffee in Zürich. They talked about the café and its new menu. Ms. Nguyen ordered a flat white, and Søren asked for tea. Schrödinger arrived late and apologised in French. Then they walked to the Bahnhof together. By evening they had planned a trip to Malmö.' },
  { name: 'Long sentence with clauses', text: 'Although the guide admits that the business case is weaker than the enthusiasm around it, it argues that the language is good. It also says that the tools are maturing, and that a careful, staged rollout lets a manager stop early without losing much. Some readers will find this disappointing, because they wanted a clear endorsement. Others will see it as the honest position of a balanced review. Either way, the advice is to start small. Measure the results before expanding.' },
  { name: 'Emotional range', text: 'I cannot believe it actually worked! Honestly, that is wonderful news. But wait, what happens next? Oh no, the file was deleted. Calm down, we still have the backup. Thank you so much for your patience... it means a lot. Let us celebrate tonight!' },
  { name: 'Technical values and units', text: 'Set the stability to 0.35. Set the similarity to 0.8. Set the speed to 0.95. Then render the take at 44.1 kilohertz. Check the peak level, which should stay below minus one decibel. Compare the loudness against the target of minus eighteen LUFS. Repeat the test with a seed of 42. Record the result in the log.' },
  { name: 'Conversational fillers', text: 'Right, so, um, the point is... yes, exactly. Hold on, let me think about that for a moment. Okay, that is a good point. I am not sure I agree with the last one, though. Well, actually, you might be right. Hmm, let us see how it sounds. Alright, moving on.' },
  { name: 'Stress test', text: 'In 2026, Dr. Odom\'s team at ACME Corp. reported a 3.7x speedup (p < 0.05) across 14 sites. They wrote \'no-op\' in the README. Then they asked: why? Nobody knew the answer at first. The fix took 2 hours, 15 minutes and $1,200 in cloud credits. Results: 99.9% uptime; 0 critical bugs; 4 minor issues. Could the same gain hold at scale? Let us test it on the next release, v3.2.1, due 4/1/2027.' },
];
