import pkg from '@tonejs/midi';
const { Midi } = pkg;
import fs from 'fs';

const midi = new Midi();
const track = midi.addTrack();

console.log("Generating test MIDI file...");

// 1. 测试长音符 (Test Long Note) - C4
// Start: 1s, Duration: 40s
// 用于测试 maxDuration 逻辑，确保瀑布流在音符头部离开屏幕后不消失
track.addNote({
  midi: 60, // C4
  time: 1,
  duration: 40,
  velocity: 0.8
});

// 2. 测试重叠音符 (Test Overlapping Notes / Reference Counting) - E4
// Instance A: 5s -> 10s
track.addNote({
  midi: 64, // E4
  time: 5,
  duration: 5,
  velocity: 0.7
});
// Instance B: 8s -> 13s
// 在 8s-10s 期间两个 E4 重叠。
// 琴键应当从 5s 一直亮到 13s，中间不应该熄灭。
track.addNote({
  midi: 64, // E4
  time: 8,
  duration: 5,
  velocity: 0.9
});

// 3. 测试短促和弦 (Chords)
track.addNote({ midi: 67, time: 15, duration: 0.5 }); // G4
track.addNote({ midi: 72, time: 15.1, duration: 0.5 }); // C5
track.addNote({ midi: 76, time: 15.2, duration: 0.5 }); // E5

// 4. 结尾长音 (Ending Long Note)
track.addNote({ midi: 48, time: 20, duration: 10 }); // C3

const buffer = Buffer.from(midi.toArray());
fs.writeFileSync('test_long_notes.mid', buffer);

console.log('Successfully generated test_long_notes.mid');
