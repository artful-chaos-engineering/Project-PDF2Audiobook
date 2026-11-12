// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { TTSConverter } from './ttsConverter';

try {
  // Unset API key
  delete process.env.ELEVENLABS_API_KEY;
  
  const converter = new TTSConverter({
    pdfPath: '/tmp/test.pdf',
    outputPath: '/tmp/test.mp3',
    voiceProvider: 'elevenlabs',
    voice: 'sarah',
  });
  
  console.log('❌ FAILED: Should have required API key');
  process.exit(1);
} catch (error) {
  if (error instanceof Error && error.message.includes('ELEVENLABS_API_KEY')) {
    console.log('✅ VERIFIED: API key is mandatory');
    console.log('Error message:', error.message);
    process.exit(0);
  } else {
    console.log('❌ FAILED: Wrong error:', error);
    process.exit(1);
  }
}
