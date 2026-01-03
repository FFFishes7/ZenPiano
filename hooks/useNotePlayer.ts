/**
 * Note player hook
 * Handles note state management when user plays piano manually
 */
import React, { useCallback, useRef } from 'react';
import { audioService } from '../services/audioService';
import { normalizeNote } from '../utils/noteUtils';
import { PianoStatus } from '../types';

interface UseNotePlayerOptions {
  status: PianoStatus;
  activeNotes: Map<string, number>;
  setActiveNotes: React.Dispatch<React.SetStateAction<Map<string, number>>>;
}

interface UseNotePlayerReturn {
  handleNoteStart: (note: string) => void;
  handleNoteStop: (note: string) => void;
}

/**
 * Manage piano note playback
 * - Handle note start/stop events
 * - Forbid user input during AI playback
 */
export const useNotePlayer = ({
  status,
  activeNotes,
  setActiveNotes,
}: UseNotePlayerOptions): UseNotePlayerReturn => {
  // Use a local Ref as the Source of Truth for logic to ensure synchronous updates.
  // We initialize it with the passed prop to ensure consistency on mount.
  // Note: We don't sync it back from props in useEffect because this hook 
  // "owns" the mutation logic. The prop is just for initial state or external resets.
  const internalActiveNotesRef = useRef<Map<string, number>>(activeNotes);

  // Sync ref if external activeNotes changes significantly (e.g. clearAllNotes)
  // This covers cases where parent clears notes (Stop button)
  if (activeNotes.size === 0 && internalActiveNotesRef.current.size !== 0) {
      internalActiveNotesRef.current = new Map();
  }

  const handleNoteStart = useCallback((note: string) => {
    // Forbid user manual play during song playback
    if (status === PianoStatus.PLAYING_SONG) return;
    
    const normalized = normalizeNote(note);
    if (!normalized) return;
    
    const notesMap = internalActiveNotesRef.current;
    const currentCount = notesMap.get(normalized) || 0;

    // Logic: If count is 0, start the tone.
    if (currentCount === 0) {
      audioService.startTone(normalized);
    }
    
    // Update Source of Truth SYNCHRONOUSLY
    notesMap.set(normalized, currentCount + 1);
    
    // Trigger UI update (Asynchronous)
    setActiveNotes(new Map(notesMap));
  }, [status, setActiveNotes]);

  const handleNoteStop = useCallback((note: string) => {
    // Forbid user manual operation during song playback
    if (status === PianoStatus.PLAYING_SONG) return;
    
    const normalized = normalizeNote(note);
    if (!normalized) return;
    
    const notesMap = internalActiveNotesRef.current;
    const currentCount = notesMap.get(normalized) || 0;
    
    // Logic: If count becomes 0 (or less), stop the tone.
    if (currentCount <= 1) {
       audioService.stopTone(normalized);
       notesMap.delete(normalized);
    } else {
       notesMap.set(normalized, currentCount - 1);
    }

    // Trigger UI update (Asynchronous)
    setActiveNotes(new Map(notesMap));
  }, [status, setActiveNotes]);

  return {
    handleNoteStart,
    handleNoteStop,
  };
};
