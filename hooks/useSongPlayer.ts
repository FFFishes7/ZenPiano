/**
 * Song player hook
 * Handles AI-generated song and MIDI file playback logic
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Midi } from '@tonejs/midi';
import { audioService } from '../services/audioService';
import { generateSong } from '../services/geminiService';
import { normalizeNote } from '../utils/noteUtils';
import { PianoStatus, SongResponse, FlatNoteEvent } from '../types';
import { MAX_MIDI_FILE_SIZE } from '../constants';

interface UseSongPlayerOptions {
  activeNotesRef: React.MutableRefObject<Map<string, number>>;
  setActiveNotes: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  clearAllNotes: () => void;
}

interface UseSongPlayerReturn {
  status: PianoStatus;
  currentSong: SongResponse | null;
  flatEvents: FlatNoteEvent[];
  playbackProgress: number;
  totalDuration: number;
  handleGenerateAndPlay: (prompt: string) => Promise<void>;
  handleMidiUpload: (file: File) => Promise<void>;
  handlePlay: () => void;
  handlePause: () => void;
  handleStop: () => void;
}

/**
 * Convert SongResponse to FlatNoteEvent array
 */
const getFlatEvents = (song: SongResponse | null): FlatNoteEvent[] => {
  if (!song) return [];
  
  let currentTime = 0;
  const flatEvents: FlatNoteEvent[] = [];
  
  song.events.forEach(event => {
    event.keys.forEach(key => {
      const normalized = normalizeNote(key);
      if (normalized) {
        flatEvents.push({
          note: normalized,
          time: currentTime,
          duration: event.duration,
          velocity: event.velocity ?? 0.7,
        });
      }
    });
    currentTime += event.duration;
  });
  
  return flatEvents;
};

/**
 * Manage song playback state and logic
 * - AI song generation
 * - MIDI file import
 * - Playback control (play/pause/stop)
 * - Progress tracking
 */
export const useSongPlayer = ({
  activeNotesRef,
  setActiveNotes,
  clearAllNotes,
}: UseSongPlayerOptions): UseSongPlayerReturn => {
  const [status, setStatus] = useState<PianoStatus>(PianoStatus.IDLE);
  const [currentSong, setCurrentSong] = useState<SongResponse | null>(null);
  const [flatEvents, setFlatEvents] = useState<FlatNoteEvent[]>([]);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);

  const rafRef = useRef<number>(0);
  const generationIdRef = useRef<number>(0);

  // Cleanup and passive suspend handling
  useEffect(() => {
    // Register listener for passive suspension (e.g. browser backgrounding)
    audioService.setPassivePauseHandler(() => {
        setStatus(prev => {
            if (prev === PianoStatus.PLAYING_SONG) {
                return PianoStatus.PAUSED;
            }
            return prev;
        });
    });

    return () => {
      audioService.stopSequence();
      cancelAnimationFrame(rafRef.current);
      audioService.setPassivePauseHandler(() => {}); // Clear on unmount
    };
  }, []);

  // Progress tracking animation loop - only runs when playing or paused
  useEffect(() => {
    // Only start RAF when actively playing or paused with valid duration
    if ((status !== PianoStatus.PLAYING_SONG && status !== PianoStatus.PAUSED) || totalDuration <= 0) {
      return;
    }

    const updateProgress = () => {
      const current = audioService.getCurrentTime();
      const pct = (current / totalDuration) * 100;
      setPlaybackProgress(Math.min(pct, 100));
      rafRef.current = requestAnimationFrame(updateProgress);
    };
    rafRef.current = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, totalDuration]);

  /**
   * Schedule note events for playback (Cache Phase)
   */
  const schedulePlayback = useCallback((
    events: FlatNoteEvent[]
  ) => {
    // Just cache the data in the service. Callbacks will be provided at Play time.
    audioService.scheduleEvents(events);
  }, []);

  const handlePlay = useCallback(() => {
    let callbacks = undefined;

    // Session ID management: only increment if we are NOT resuming from pause.
    // This marks the start of a "New Play Session" and generates fresh callbacks.
    if (status !== PianoStatus.PAUSED) {
      const newId = ++generationIdRef.current;
      
      callbacks = {
        onNoteStart: (note: string) => {
          if (newId !== generationIdRef.current) return;
          const n = normalizeNote(note);
          if (n) {
            // FAST PATH: Direct ref update
            const currentCount = activeNotesRef.current.get(n) || 0;
            activeNotesRef.current.set(n, currentCount + 1);

            // SLOW PATH: React state sync
            setActiveNotes(prev => {
              const next = new Map<string, number>(prev);
              const c = next.get(n) || 0;
              next.set(n, c + 1);
              return next;
            });
          }
        },
        onNoteStop: (note: string) => {
          if (newId !== generationIdRef.current) return;
          const n = normalizeNote(note);
          if (n) {
            // FAST PATH: Direct ref update
            const currentCount = activeNotesRef.current.get(n) || 0;
            if (currentCount <= 1) {
                activeNotesRef.current.delete(n);
            } else {
                activeNotesRef.current.set(n, currentCount - 1);
            }

            // SLOW PATH: React state sync
            setActiveNotes(prev => {
              const next = new Map<string, number>(prev);
              const c = next.get(n) || 0;
              if (c <= 1) {
                next.delete(n);
              } else {
                next.set(n, c - 1);
              }
              return next;
            });
          }
        },
        onEnd: () => {
          if (newId !== generationIdRef.current) return;
          audioService.resetPlayback();
          setStatus(PianoStatus.READY);
          clearAllNotes();
        }
      };
    }
    
    // If callbacks are provided, AudioService will use them for a fresh rebuild.
    // If undefined (Resume), it uses the active session callbacks.
    audioService.play(callbacks);
    setStatus(PianoStatus.PLAYING_SONG);
  }, [status, setActiveNotes, clearAllNotes, activeNotesRef]);

  /**
   * Process and play MIDI data
   */
  const processAndPlayMidi = useCallback(async (arrayBuffer: ArrayBuffer, name: string) => {
    // Stop any currently playing content first & destroy old instances
    audioService.resetPlayback();
    clearAllNotes();

    const currentId = ++generationIdRef.current;
    
    try {
      const midi = new Midi(arrayBuffer);
      const events: FlatNoteEvent[] = [];
      let maxDuration = 0;
      
      midi.tracks.forEach(track => {
        track.notes.forEach(note => {
          const normalized = normalizeNote(note.name);
          if (normalized) {
            maxDuration = Math.max(maxDuration, note.duration);
            events.push({
              note: normalized,
              time: note.time,
              duration: note.duration,
              velocity: note.velocity,
            });
          }
        });
      });

      if (currentId !== generationIdRef.current) return;

      if (events.length === 0) {
        setStatus(PianoStatus.IDLE);
        throw new Error('No notes found in MIDI file.');
      }

      const duration = events.reduce((acc, curr) => Math.max(acc, curr.time + curr.duration), 0);
      setTotalDuration(duration);
      setFlatEvents(events);
      setStatus(PianoStatus.READY);
      
      setCurrentSong({ 
        songName: name, 
        description: 'Imported MIDI', 
        tempo: 0, 
        events: [],
        maxDuration: maxDuration 
      });

      await audioService.ensureContext();

      if (currentId !== generationIdRef.current) return;

      schedulePlayback(events);
      // Auto-play removed per user request. Status stays at READY.
    } catch (e: any) {
      if (currentId !== generationIdRef.current) return;
      console.error(e);
      setStatus(PianoStatus.IDLE);
      throw e;
    }
  }, [clearAllNotes, schedulePlayback, handlePlay]);

  /**
   * Upload MIDI file
   */
  const handleMidiUpload = useCallback(async (file: File) => {
    if (!file) return;

    // Validate file size
    if (file.size > MAX_MIDI_FILE_SIZE) {
      alert(`MIDI file too large. Maximum size is ${MAX_MIDI_FILE_SIZE / (1024 * 1024)}MB.`);
      return;
    }

    setStatus(PianoStatus.FETCHING_AI);
    const buffer = await file.arrayBuffer();
    await processAndPlayMidi(buffer, file.name.replace(/\.mid$/i, ''));
  }, [processAndPlayMidi]);

  /**
   * AI generate and play song
   */
  const handleGenerateAndPlay = useCallback(async (prompt: string) => {
    // Stop any currently playing content first & destroy old instances
    audioService.resetPlayback();
    clearAllNotes();

    setStatus(PianoStatus.FETCHING_AI);
    setCurrentSong(null);
    const currentId = ++generationIdRef.current;

    try {
      const songData = await generateSong(prompt);

      if (currentId !== generationIdRef.current) return;

      const flat = getFlatEvents(songData);
      
      const maxDuration = flat.reduce((max, event) => Math.max(max, event.duration), 0);
      songData.maxDuration = maxDuration;

      setFlatEvents(flat);
      
      const duration = flat.reduce((acc, curr) => Math.max(acc, curr.time + curr.duration), 0);
      setTotalDuration(duration);
      setCurrentSong(songData);
      setStatus(PianoStatus.READY);

      await audioService.ensureContext();

      if (currentId !== generationIdRef.current) return;

      schedulePlayback(flat);
      // Auto-play removed per user request. Status stays at READY.
    } catch (error: any) {
      if (currentId !== generationIdRef.current) return;
      console.error(error);
      setStatus(PianoStatus.IDLE);
      throw error;
    }
  }, [clearAllNotes, schedulePlayback, handlePlay]);

  const handlePause = useCallback(() => {
    audioService.pause();
    setStatus(PianoStatus.PAUSED);
  }, []);

  const handleStop = useCallback(() => {
    audioService.resetPlayback(); // Completely stop, clear, and DESTROY instances
    setStatus(PianoStatus.IDLE);
    clearAllNotes();
    setPlaybackProgress(0);
    setCurrentSong(null);
    setFlatEvents([]); // Clear the note events so Waterfall view becomes empty
    // Incrementing session ID here invalidates any pending async callbacks from the previous session.
    generationIdRef.current++;
  }, [clearAllNotes]);

  return {
    status,
    currentSong,
    flatEvents,
    playbackProgress,
    totalDuration,
    handleGenerateAndPlay,
    handleMidiUpload,
    handlePlay,
    handlePause,
    handleStop,
  };
};
