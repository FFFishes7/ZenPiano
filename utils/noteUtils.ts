/**
 * Note processing utility functions
 * Centralized logic for note normalization, validation, conversion, etc.
 */

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
