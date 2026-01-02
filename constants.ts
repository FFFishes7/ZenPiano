import { NoteDefinition } from './types';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const generate88Keys = (): NoteDefinition[] => {
  const keys: NoteDefinition[] = [];
  let whiteKeyCount = 0;

  // Piano starts at A0 (Key 1) and ends at C8 (Key 88)
  // A0 is index 9 in NOTES array relative to C0.
  // We iterate MIDI note numbers 21 (A0) to 108 (C8)
  
  for (let i = 21; i <= 108; i++) {
    const octave = Math.floor(i / 12) - 1;
    const noteIndex = i % 12;
    const noteName = NOTES[noteIndex];
    const fullNote = `${noteName}${octave}`;
    const isBlack = noteName.includes('#');
    
    // Frequency calculation: f = 440 * 2^((n-69)/12) where n is MIDI number (A4 = 69)
    const frequency = 440 * Math.pow(2, (i - 69) / 12);

    // Simple key bindings for the middle range (C4 - E5 approx)
    let keyBinding: string | undefined = undefined;
    if (i >= 60 && i <= 84) { // C4 is 60. 
        // We can map some keys if needed, but for 88 keys, manual play is usually click-based 
        // or a very specific subset. Let's map C4 octave to home row.
        const map = "awsedftgyhujkolp;"; // Rough mapping
        const offset = i - 60;
        if (offset < map.length) keyBinding = map[offset];
    }

    keys.push({
      note: fullNote,
      frequency,
      type: isBlack ? 'black' : 'white',
      octave,
      index: i - 21,
      whiteKeyIndex: isBlack ? whiteKeyCount : whiteKeyCount++, // Black keys share index with previous white for positioning logic
      keyBinding
    });
  }
  return keys;
};

export const PIANO_KEYS = generate88Keys();
