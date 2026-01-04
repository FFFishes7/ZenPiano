/**
 * Note processing utility functions
 * Centralized logic for note normalization, validation, conversion, etc.
 */

import { FlatNoteEvent, MappedNoteEvent } from '../types';
import { PIANO_KEYS } from '../constants';

// Set of valid note names
const VALID_NOTE_NAMES = new Set([
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Db', 'Eb', 'Gb', 'Ab', 'Bb'
]);

// Regex for note format validation
const NOTE_PATTERN = /^([A-Ga-g][#b]?)(\d)$/;

// Mapping from flat to sharp
const FLAT_TO_SHARP_MAP: Record<string, string> = {
  'D': 'C#',
  'E': 'D#',
  'G': 'F#',
  'A': 'G#',
  'B': 'A#',
};

// LRU Cache for normalizeNote to avoid repeated string operations on hot paths
const NORMALIZE_CACHE_MAX_SIZE = 128;
const normalizeCache = new Map<string, string | null>();

/**
 * Normalize note name
 * - Validate note format
 * - Convert flat to enharmonic sharp (e.g. Db -> C#)
 * - Standardize case
 *
 * @param note Original note name (e.g. "C4", "db5", "F#3")
 * @returns Normalized note name, or null if invalid
 */
export const normalizeNote = (note: string): string | null => {
  if (!note) return null;
  
  // Check cache first for hot path optimization
  if (normalizeCache.has(note)) {
    return normalizeCache.get(note)!;
  }
  
  // Validate note format
  const match = note.match(NOTE_PATTERN);
  if (!match) {
    cacheResult(note, null);
    return null;
  }
  
  const [, noteName, octave] = match;
  const upperNoteName = noteName.charAt(0).toUpperCase() + noteName.slice(1).toLowerCase();
  
  // Validate if note name is valid
  if (!VALID_NOTE_NAMES.has(upperNoteName)) {
    cacheResult(note, null);
    return null;
  }
  
  // Validate octave range (Piano range A0-C8)
  const octaveNum = parseInt(octave, 10);
  if (octaveNum < 0 || octaveNum > 8) {
    cacheResult(note, null);
    return null;
  }
  
  // Convert flat to sharp and standardize case
  let resultNoteName = upperNoteName;
  if (upperNoteName.endsWith('b')) {
    const baseChar = upperNoteName.charAt(0);
    resultNoteName = FLAT_TO_SHARP_MAP[baseChar] || upperNoteName;
  }
  
  const normalized = resultNoteName + octave;
  cacheResult(note, normalized);
  return normalized;
};

/**
 * Helper to cache normalization result with LRU eviction
 */
const cacheResult = (key: string, value: string | null): void => {
  // Simple LRU: delete oldest entries when cache is full
  if (normalizeCache.size >= NORMALIZE_CACHE_MAX_SIZE) {
    const firstKey = normalizeCache.keys().next().value;
    if (firstKey !== undefined) {
      normalizeCache.delete(firstKey);
    }
  }
  normalizeCache.set(key, value);
};

/**
 * Validate if the note is valid
 */
export const isValidNote = (note: string): boolean => {
  return normalizeNote(note) !== null;
};

/**
 * Get the octave of the note
 */
export const getNoteOctave = (note: string): number | null => {
  const match = note.match(NOTE_PATTERN);
  if (!match) return null;
  return parseInt(match[2], 10);
};

/**
 * Get the base name of the note (without octave)
 */
export const getNoteName = (note: string): string | null => {
  const match = note.match(NOTE_PATTERN);
  if (!match) return null;
  return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
};

/**
 * Binary search to find the first event index that starts at or after the given time
 */
export const findStartIndex = (events: FlatNoteEvent[] | MappedNoteEvent[], time: number): number => {
    let low = 0;
    let high = events.length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid].time < time) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return low;
};

/**
 * Pre-process note events: map key index, filter invalid, and sort by time
 */
export const prepareNoteEvents = (events: FlatNoteEvent[]): MappedNoteEvent[] => {
    return events.map(event => ({
        ...event,
        keyIndex: PIANO_KEYS.findIndex(k => k.note === event.note)
    }))
    .filter(e => e.keyIndex !== -1)
    .sort((a, b) => a.time - b.time);
};

/**
 * Calculate the set of notes that are mathematically active at the current time.
 * This is used for zero-latency rendering of visual indicators.
 */
export const getMathematicallyActiveNotes = (
    events: FlatNoteEvent[] | MappedNoteEvent[],
    currentTime: number,
    maxDuration: number
): Set<string> => {
    const activeNotes = new Set<string>();
    if (events.length === 0) return activeNotes;

    // Use dynamic look-back based on the longest note to find any notes still playing
    const minVisibleStartTime = currentTime - (maxDuration + 2.0);
    const startIndex = findStartIndex(events, minVisibleStartTime);

    for (let i = startIndex; i < events.length; i++) {
        const event = events[i];
        if (event.time > currentTime) break; // Future event
        
        // If current time is between start and end of the note
        // Use >= to ensure notes at exactly 0s can be active, 
        // but component should guard this with isPlaying check.
        if (currentTime >= event.time && currentTime < event.time + event.duration) {
            activeNotes.add(event.note);
        }
    }
    return activeNotes;
};

/**
 * Clean up visual overlaps for the same note.
 * If a note starts while the previous one of the same pitch is still being held (visually),
 * truncate the previous note's DURATION (finger hold) so it ends exactly when the new one starts.
 * This prevents "impossible same-key" visualization while allowing polyphony across different keys.
 */
export const cleanupVisualOverlaps = (events: FlatNoteEvent[]): FlatNoteEvent[] => {
    const notesByPitch = new Map<string, FlatNoteEvent[]>();
    
    events.forEach(event => {
        if (!notesByPitch.has(event.note)) {
            notesByPitch.set(event.note, []);
        }
        notesByPitch.get(event.note)!.push(event);
    });

    notesByPitch.forEach(noteList => {
        // Events are likely already sorted by time from prepareNoteEvents, but let's be safe
        noteList.sort((a, b) => a.time - b.time);

        for (let i = 0; i < noteList.length - 1; i++) {
            const current = noteList[i];
            const next = noteList[i + 1];

            if (current.time + current.duration > next.time) {
                // Ensure audio is preserved in holdDuration before truncating visual duration
                if (current.holdDuration === undefined) {
                    current.holdDuration = current.duration;
                }
                current.duration = Math.max(0.01, next.time - current.time);
            }
        }
    });

    return events;
};
