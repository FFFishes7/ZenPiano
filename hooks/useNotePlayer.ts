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
  activeNotes: Set<string>;
  setActiveNotes: React.Dispatch<React.SetStateAction<Set<string>>>;
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
      if (prev.has(normalized)) return prev; // Avoid unnecessary Set creation
      const next = new Set(prev);
      next.add(normalized);
      return next;
    });
    
    audioService.startTone(normalized);
  }, [status, setActiveNotes]);

  const handleNoteStop = useCallback((note: string) => {
    // Forbid user manual operation during song playback
    if (status === PianoStatus.PLAYING_SONG) return;
    
    const normalized = normalizeNote(note);
    if (!normalized) return;
    
    setActiveNotes(prev => {
      if (!prev.has(normalized)) return prev; // Avoid unnecessary Set creation
      const next = new Set(prev);
      next.delete(normalized);
      return next;
    });
    
    audioService.stopTone(normalized);
  }, [status, setActiveNotes]);

  return {
    handleNoteStart,
    handleNoteStop,
  };
};
