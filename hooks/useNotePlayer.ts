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
  activeNotesRef: React.MutableRefObject<Map<string, number>>;
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
  activeNotesRef,
}: UseNotePlayerOptions): UseNotePlayerReturn => {
  // Source of Truth for logic (Synchronous)
  const internalActiveNotesRef = useRef<Map<string, number>>(new Map());

  // Handle external clears (e.g. Stop button) by checking the fast path ref
  // If the fast path is empty but our internal is not, sync it.
  if (activeNotesRef.current.size === 0 && internalActiveNotesRef.current.size !== 0) {
      internalActiveNotesRef.current = new Map();
  }

  // Safety Sync: If the tab is hidden, audioService forcibly kills voices.
  // We must sync our internal logic to avoid "ghost" active states.
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        internalActiveNotesRef.current.clear();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

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
    
    // Update Fast Path Ref Immediately for Visuals
    const fastCount = activeNotesRef.current.get(normalized) || 0;
    activeNotesRef.current.set(normalized, fastCount + 1);
  }, [status, activeNotesRef]);

  const handleNoteStop = useCallback((note: string) => {
    // Forbid user manual operation during song playback
    if (status === PianoStatus.PLAYING_SONG) return;
    
    const normalized = normalizeNote(note);
    if (!normalized) return;
    
    const notesMap = internalActiveNotesRef.current;
    const currentCount = notesMap.get(normalized) || 0;
    
    // Logic: Only proceed if we actually have a record of this note playing
    if (currentCount > 0) {
      if (currentCount === 1) {
         audioService.stopTone(normalized);
         notesMap.delete(normalized);
      } else {
         notesMap.set(normalized, currentCount - 1);
      }
    }

    // Update Fast Path Ref Immediately for Visuals
    const fastCount = activeNotesRef.current.get(normalized) || 0;
    if (fastCount > 0) {
      if (fastCount === 1) {
          activeNotesRef.current.delete(normalized);
      } else {
          activeNotesRef.current.set(normalized, fastCount - 1);
      }
    }
  }, [status, activeNotesRef]);

  return {
    handleNoteStart,
    handleNoteStop,
  };
};
