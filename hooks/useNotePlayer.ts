/**
 * Note player hook
 * Handles note state management when user plays piano manually
 */
import React, { useCallback } from 'react';
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
  const handleNoteStart = useCallback((note: string) => {
    // Forbid user manual play during song playback
    if (status === PianoStatus.PLAYING_SONG) return;
    
    const normalized = normalizeNote(note);
    if (!normalized) return;
    
    setActiveNotes(prev => {
      const next = new Map(prev);
      const currentCount = next.get(normalized) || 0;
      next.set(normalized, currentCount + 1);
      return next;
    });
    
    // Only start tone if it wasn't already playing (count was 0)
    if ((activeNotes.get(normalized) || 0) === 0) {
      audioService.startTone(normalized);
    }
  }, [status, setActiveNotes, activeNotes]);

  const handleNoteStop = useCallback((note: string) => {
    // Forbid user manual operation during song playback
    if (status === PianoStatus.PLAYING_SONG) return;
    
    const normalized = normalizeNote(note);
    if (!normalized) return;
    
    setActiveNotes(prev => {
      const next = new Map(prev);
      const currentCount = next.get(normalized) || 0;
      if (currentCount <= 1) {
        next.delete(normalized);
      } else {
        next.set(normalized, currentCount - 1);
      }
      return next;
    });
    
    // Only stop tone if this was the last instance (count becomes 0)
    if ((activeNotes.get(normalized) || 0) <= 1) {
      audioService.stopTone(normalized);
    }
  }, [status, setActiveNotes, activeNotes]);

  return {
    handleNoteStart,
    handleNoteStop,
  };
};
