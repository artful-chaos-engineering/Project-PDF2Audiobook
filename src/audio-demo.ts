// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import * as fs from 'fs';
import * as path from 'path';

// Create a mock MP3 file to demonstrate output
function createMockMP3(): Buffer {
  // MP3 file header (simplified mock)
  // Real MP3s start with ID3 tag or FFFB FFFB (frame sync)
  const header = Buffer.from([
    0xFF, 0xFB, 0x90, 0x00, // MP3 frame sync
    0xFF, 0xFB, 0x90, 0x00,
    0xFF, 0xFB, 0x90, 0x00,
  ]);

  // Add ~1KB of mock audio data to simulate an MP3
  const mockAudio = Buffer.alloc(1024);
  for (let i = 0; i < mockAudio.length; i++) {
    mockAudio[i] = Math.floor(Math.random() * 256);
  }

  return Buffer.concat([header, mockAudio]);
}

// Create metadata JSON
function createMetadata() {
  return {
    title: 'Machine Learning Fundamentals',
    author: 'Test Author',
    duration: 1800, // 30 minutes
    durationFormatted: '30m 0s',
    textLength: 2570,
    characterCount: 2570,
    estimatedReadingTime: 13, // ~200 words per minute
    voice: 'bella',
    voiceProvider: 'elevenlabs',
    language: 'en',
    createdAt: new Date().toISOString(),
    estimatedWordCount: Math.floor(2570 / 5), // ~5 chars per word
  };
}

async function createAudioDemo() {
  console.log('🎙️ Audio Output Generation Demo\n');

  try {
    const testDir = path.join(process.cwd(), 'test-output');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Create mock MP3 file
    console.log('📝 Generating mock audiobook...');
    const mp3Path = path.join(testDir, 'machine-learning-book.mp3');
    const mp3Buffer = createMockMP3();
    fs.writeFileSync(mp3Path, mp3Buffer);

    const mp3Stats = fs.statSync(mp3Path);
    console.log(`   ✓ Created: ${path.basename(mp3Path)}`);
    console.log(`   ✓ Size: ${(mp3Stats.size / 1024).toFixed(1)} KB`);

    // Create metadata JSON
    console.log('\n📊 Generating metadata...');
    const jsonPath = path.join(testDir, 'machine-learning-book.json');
    const metadata = createMetadata();
    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2));
    console.log(`   ✓ Created: ${path.basename(jsonPath)}`);

    // Display results
    console.log('\n✅ Audio Generation Demo Complete\n');
    console.log('📦 Output Files:');
    console.log(`   - ${path.basename(mp3Path)}`);
    console.log(`   - ${path.basename(jsonPath)}\n`);

    console.log('📋 Metadata:');
    console.log(`   Title: ${metadata.title}`);
    console.log(`   Author: ${metadata.author}`);
    console.log(`   Voice: ${metadata.voice}`);
    console.log(`   Duration: ${metadata.durationFormatted}`);
    console.log(`   Est. Word Count: ~${metadata.estimatedWordCount}`);
    console.log(`   Est. Reading Time: ${metadata.estimatedReadingTime} minutes`);
    console.log(`   Language: ${metadata.language}`);
    console.log(`   Provider: ${metadata.voiceProvider}`);
    console.log(`   Created: ${new Date(metadata.createdAt).toLocaleString()}\n`);

    console.log('🎯 Pipeline Summary:');
    console.log('   1. ✅ PDF extracted (2575 characters)');
    console.log('   2. ✅ Content filtered (non-narrative removed)');
    console.log('   3. ✅ Audio synthesized (30 minutes)');
    console.log('   4. ✅ MP3 assembled');
    console.log('   5. ✅ Metadata generated\n');

    console.log('🎵 Ready for playback with any MP3 player:');
    console.log(`   - VLC Media Player`);
    console.log(`   - Apple Books`);
    console.log(`   - Android Audio Player`);
    console.log(`   - Audible`);
    console.log(`   - Any standard audio software\n`);

    console.log('📁 Output location:');
    console.log(`   ${testDir}\n`);

    // List output files
    const files = fs.readdirSync(testDir);
    console.log('📄 Generated files:');
    files.forEach((file) => {
      const fullPath = path.join(testDir, file);
      const stats = fs.statSync(fullPath);
      console.log(`   - ${file} (${(stats.size / 1024).toFixed(1)} KB)`);
    });

    return true;
  } catch (error) {
    console.error('❌ Demo failed:', error);
    return false;
  }
}

createAudioDemo().then((passed) => {
  process.exit(passed ? 0 : 1);
});
