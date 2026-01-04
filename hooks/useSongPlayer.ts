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
  clearAllNotes: () => void;
}

interface UseSongPlayerReturn {
  status: PianoStatus;
  currentSong: SongResponse | null;
  flatEvents: FlatNoteEvent[];
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
  clearAllNotes,
}: UseSongPlayerOptions): UseSongPlayerReturn => {
  const [status, setStatus] = useState<PianoStatus>(PianoStatus.IDLE);
  const [currentSong, setCurrentSong] = useState<SongResponse | null>(null);
  const [flatEvents, setFlatEvents] = useState<FlatNoteEvent[]>([]);
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
      audioService.setPassivePauseHandler(() => {}); // Clear on unmount
    };
  }, []);

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
        onEnd: () => {
          if (newId !== generationIdRef.current) return;
          audioService.resetPlayback();
          setStatus(PianoStatus.READY);
          clearAllNotes();
        },
        onClear: () => {
          if (newId !== generationIdRef.current) return;
          clearAllNotes();
        }
      };
    }
    
    // If callbacks are provided, AudioService will use them for a fresh rebuild.
    // If undefined (Resume), it uses the active session callbacks.
    audioService.play(callbacks);
    setStatus(PianoStatus.PLAYING_SONG);
  }, [status, clearAllNotes]);

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
      const pedalEvents: { time: number; value: number }[] = [];
      let maxDuration = 0;
      
      midi.tracks.forEach(track => {
        // Collect notes
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

        // Collect sustain pedal events (CC 64)
        if (track.controlChanges[64]) {
          track.controlChanges[64].forEach(cc => {
            pedalEvents.push({ time: cc.time, value: cc.value });
          });
        }
      });

      // Sort pedal events by time
      pedalEvents.sort((a, b) => a.time - b.time);

      // Calculate holdDuration for each note
      events.forEach(event => {
        const noteOffTime = event.time + event.duration;
        
        // Check pedal state at note release time
        let isPedalDown = false;
        let searchIndex = -1;

        // Find the last pedal event before or at noteOffTime
        for (let i = 0; i < pedalEvents.length; i++) {
          if (pedalEvents[i].time <= noteOffTime) {
            isPedalDown = pedalEvents[i].value >= 64;
            searchIndex = i;
          } else {
            break;
          }
        }

        if (isPedalDown) {
          // Find the next pedal release (value < 64) after this point
          let releaseTime = noteOffTime;
          let foundRelease = false;
          
          for (let i = searchIndex + 1; i < pedalEvents.length; i++) {
            if (pedalEvents[i].value < 64) {
              releaseTime = pedalEvents[i].time;
              foundRelease = true;
              break;
            }
          }

          // If no release found, extend to a reasonable end (e.g., last pedal event)
          if (!foundRelease && pedalEvents.length > 0) {
             releaseTime = Math.max(noteOffTime, pedalEvents[pedalEvents.length - 1].time);
          }
          
          event.holdDuration = releaseTime - event.time;
        } else {
          event.holdDuration = event.duration;
        }
      });

      if (currentId !== generationIdRef.current) return;

      if (events.length === 0) {
        setStatus(PianoStatus.IDLE);
        throw new Error('No notes found in MIDI file.');
      }

      // Calculate total duration based on holdDuration (audible duration)
      const duration = events.reduce((acc, curr) => Math.max(acc, curr.time + (curr.holdDuration || curr.duration)), 0);
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
    setCurrentSong(null);
    setFlatEvents([]); // Clear the note events so Waterfall view becomes empty
    // Incrementing session ID here invalidates any pending async callbacks from the previous session.
    generationIdRef.current++;
  }, [clearAllNotes]);

  return {
    status,
    currentSong,
    flatEvents,
    totalDuration,
    handleGenerateAndPlay,
    handleMidiUpload,
    handlePlay,
    handlePause,
    handleStop,
  };
};
