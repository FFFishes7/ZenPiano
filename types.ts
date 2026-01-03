/**
 * Piano key definition
 */
export interface NoteDefinition {
  note: string;
  frequency: number;
  type: 'white' | 'black';
  octave: number;
  index: number; // Index in the 88 keys
  whiteKeyIndex: number; // Index among white keys only (for positioning)
  keyBinding?: string; 
}

/**
 * AI-generated musical event (can contain chords)
 */
export interface MusicalEvent {
  keys: string[]; // Array of notes for chords (e.g., ["C4", "E4", "G4"])
  duration: number; // in seconds
  velocity?: number; // Optional velocity (0.0 to 1.0) for dynamics
}

/**
 * AI-generated song response
 */
export interface SongResponse {
  songName: string;
  tempo: number; 
  events: MusicalEvent[];
  description: string;
  maxDuration?: number; // Max duration of a single note event in seconds
}

/**
 * Flattened note event (for playback and waterfall display)
 */
export interface FlatNoteEvent {
  note: string;
  time: number;
  duration: number;
  velocity: number;
}

/**
 * Mapped note event with pre-calculated key index
 */
export interface MappedNoteEvent extends FlatNoteEvent {
  keyIndex: number;
}

/**
 * Piano status enum
 */
export enum PianoStatus {
  IDLE = 'IDLE',
  FETCHING_AI = 'FETCHING_AI',
  READY = 'READY',        // Song loaded, ready to play
  PLAYING_SONG = 'PLAYING_SONG',  // Playing AI-generated or imported MIDI
  PAUSED = 'PAUSED',
}

/**
 * View mode
 */
export type ViewMode = 'PIANO' | 'WATERFALL';

/**
 * Audio quality setting
 */
export type AudioQuality = 'LIGHT';