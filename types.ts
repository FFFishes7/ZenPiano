
export interface NoteDefinition {
  note: string;
  frequency: number;
  type: 'white' | 'black';
  octave: number;
  index: number; // Index in the 88 keys
  whiteKeyIndex: number; // Index among white keys only (for positioning)
  keyBinding?: string; 
}

export interface MusicalEvent {
  keys: string[]; // Array of notes for chords (e.g., ["C4", "E4", "G4"])
  duration: number; // in seconds
  velocity?: number; // Optional velocity (0.0 to 1.0) for dynamics
}

export interface SongResponse {
  songName: string;
  tempo: number; 
  events: MusicalEvent[];
  description: string;
}

export enum PianoStatus {
  IDLE = 'IDLE',
  FETCHING_AI = 'FETCHING_AI',
  READY = 'READY',      // Loaded but not playing
  PLAYING_AI = 'PLAYING_AI',
  PAUSED = 'PAUSED',
}

export type ViewMode = 'PIANO' | 'WATERFALL';
export type AudioQuality = 'LIGHT';