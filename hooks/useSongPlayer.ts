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

  // Cleanup resources
  useEffect(() => {
    return () => {
      audioService.stopSequence();
      cancelAnimationFrame(rafRef.current);
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
   * Schedule note events for playback
   */
  const schedulePlayback = useCallback((
    events: FlatNoteEvent[],
    currentId: number
  ) => {
    audioService.scheduleEvents(
      events,
      // onNoteStart
      (note) => {
        if (currentId !== generationIdRef.current) return;
        const n = normalizeNote(note);
        if (n) {
          setActiveNotes(prev => {
            const next = new Map(prev);
            const currentCount = next.get(n) || 0;
            next.set(n, currentCount + 1);
            return next;
          });
        }
      },
      // onNoteStop
      (note) => {
        if (currentId !== generationIdRef.current) return;
        const n = normalizeNote(note);
        if (n) {
          setActiveNotes(prev => {
            const next = new Map(prev);
            const currentCount = next.get(n) || 0;
            if (currentCount <= 1) {
              next.delete(n);
            } else {
              next.set(n, currentCount - 1);
            }
            return next;
          });
        }
      },
      // onEnd
      () => {
        if (currentId !== generationIdRef.current) return;
        audioService.stopPlayback();
        setStatus(PianoStatus.READY);
        clearAllNotes();
      }
    );
  }, [setActiveNotes, clearAllNotes]);

  /**
   * Process and play MIDI data
   */
  const processAndPlayMidi = useCallback(async (arrayBuffer: ArrayBuffer, name: string) => {
    // Stop any currently playing content first
    audioService.stopSequence();
    audioService.stopPlayback();
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
        alert('No notes found.');
        setStatus(PianoStatus.IDLE);
        return;
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
        maxDuration: maxDuration // Set calculated max duration
      });

      await audioService.ensureContext();

      if (currentId !== generationIdRef.current) return;

      schedulePlayback(events, currentId);
    } catch (e) {
      if (currentId !== generationIdRef.current) return;
      console.error(e);
      alert('Failed to parse MIDI');
      setStatus(PianoStatus.IDLE);
    }
  }, [clearAllNotes, schedulePlayback]);

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
    // Stop any currently playing content first
    audioService.stopSequence();
    audioService.stopPlayback();
    clearAllNotes();

    setStatus(PianoStatus.FETCHING_AI);
    setCurrentSong(null);
    const currentId = ++generationIdRef.current;

    try {
      const songData = await generateSong(prompt);

      if (currentId !== generationIdRef.current) return;

      const flat = getFlatEvents(songData);
      
      // Calculate max duration for AI songs
      const maxDuration = flat.reduce((max, event) => Math.max(max, event.duration), 0);
      songData.maxDuration = maxDuration;

      setFlatEvents(flat);
      
      const duration = flat.reduce((acc, curr) => Math.max(acc, curr.time + curr.duration), 0);
      setTotalDuration(duration);
      setCurrentSong(songData);
      setStatus(PianoStatus.READY);

      await audioService.ensureContext();

      if (currentId !== generationIdRef.current) return;

      schedulePlayback(flat, currentId);
    } catch (error) {
      if (currentId !== generationIdRef.current) return;
      console.error(error);
      alert('Failed to generate song.');
      setStatus(PianoStatus.IDLE);
    }
  }, [clearAllNotes, schedulePlayback]);

  const handlePlay = useCallback(() => {
    audioService.play();
    setStatus(PianoStatus.PLAYING_SONG);
  }, []);

  const handlePause = useCallback(() => {
    audioService.pause();
    setStatus(PianoStatus.PAUSED);
  }, []);

  const handleStop = useCallback(() => {
    audioService.stopSequence();
    setStatus(PianoStatus.IDLE);
    clearAllNotes();
    setPlaybackProgress(0);
    setCurrentSong(null);
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
