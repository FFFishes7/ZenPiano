
import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { PIANO_KEYS } from '../constants';
import { NoteDefinition, PianoStatus } from '../types';
import PianoKey from './PianoKey';

interface PianoProps {
  activeNotes: string[];
  onNoteStart: (note: string) => void;
  onNoteStop: (note: string) => void;
  status: PianoStatus;
}

interface KeyRect {
  note: string;
  rect: DOMRect;
  isBlack: boolean;
}

const Piano: React.FC<PianoProps> = React.memo(({ activeNotes, onNoteStart, onNoteStop, status }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastNoteRef = useRef<string | null>(null);
  
  // 1. Ref Map: Stores direct DOM references to keys
  const keysRef = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // 2. Rect Cache: Stores geometric data calculated on touchstart
  const keyRectsRef = useRef<KeyRect[]>([]);

  // Optimization: Map key bindings for O(1) lookup in event handlers
  const keyBindingMap = useMemo(() => {
    const map = new Map<string, string>();
    PIANO_KEYS.forEach(k => {
      if (k.keyBinding) map.set(k.keyBinding, k.note);
    });
    return map;
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (status === PianoStatus.PLAYING_AI) return;
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const note = keyBindingMap.get(key);
    if (note) {
      onNoteStart(note);
    }
  }, [onNoteStart, status, keyBindingMap]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (status === PianoStatus.PLAYING_AI) return;
    const key = event.key.toLowerCase();
    const note = keyBindingMap.get(key);
    if (note) {
      onNoteStop(note);
    }
  }, [onNoteStop, status, keyBindingMap]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    if (scrollContainerRef.current) {
        const scrollAmount = 1000; 
        scrollContainerRef.current.scrollLeft = scrollAmount;
    }
  }, []);

  const handlePlayStart = useCallback((noteData: NoteDefinition) => {
      if (status === PianoStatus.PLAYING_AI) return;
      onNoteStart(noteData.note);
  }, [onNoteStart, status]);
  
  const handlePlayStop = useCallback((noteData: NoteDefinition) => {
      if (status === PianoStatus.PLAYING_AI) return;
      onNoteStop(noteData.note);
  }, [onNoteStop, status]);

  // Helper to register refs from PianoKey children
  const registerKey = useCallback((note: string, el: HTMLDivElement | null) => {
    if (el) keysRef.current.set(note, el);
    else keysRef.current.delete(note);
  }, []);

  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (status === PianoStatus.PLAYING_AI) return;

    // --- PHASE 1: CACHE ON START ---
    if (e.type === 'touchstart') {
      // Disable scrolling during the gesture to ensure cached coordinates remain valid
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.overflowX = 'hidden';
      }

      const rects: KeyRect[] = [];
      keysRef.current.forEach((el, note) => {
        // Force Reflow once per session (acceptable on start)
        rects.push({
          note,
          rect: el.getBoundingClientRect(),
          isBlack: note.includes('#')
        });
      });

      // Optimization: Check Black keys first as they sit on top (Z-index high)
      rects.sort((a, b) => {
        if (a.isBlack === b.isBlack) return 0;
        return a.isBlack ? -1 : 1;
      });

      keyRectsRef.current = rects;
    }

    // --- PHASE 2: MATH ON MOVE ---
    if (e.type === 'touchstart' || e.type === 'touchmove') {
      const touch = e.touches[0];
      const cx = touch.clientX;
      const cy = touch.clientY;

      // Pure math lookup - NO DOM ACCESS here
      const hit = keyRectsRef.current.find(k => 
        cx >= k.rect.left && cx <= k.rect.right &&
        cy >= k.rect.top && cy <= k.rect.bottom
      );

      const note = hit?.note;

      if (note && note !== lastNoteRef.current) {
        if (lastNoteRef.current) onNoteStop(lastNoteRef.current);
        onNoteStart(note);
        lastNoteRef.current = note;
      } else if (!note && lastNoteRef.current) {
        onNoteStop(lastNoteRef.current);
        lastNoteRef.current = null;
      }
    } 
    
    // --- PHASE 3: CLEANUP ---
    else if (e.type === 'touchend' || e.type === 'touchcancel') {
      if (lastNoteRef.current) {
        onNoteStop(lastNoteRef.current);
        lastNoteRef.current = null;
      }
      
      // Re-enable scrolling
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.overflowX = 'auto';
      }
    }
  }, [onNoteStart, onNoteStop, status]);

  const whiteKeys = PIANO_KEYS.filter(k => k.type === 'white');
  const blackKeys = PIANO_KEYS.filter(k => k.type === 'black');

  return (
    <div 
        className="w-full relative select-none bg-slate-100/50 border-t border-b border-slate-200 shadow-inner"
        // Attach handlers to the container to manage the gesture globally
        onTouchStart={handleTouch}
        onTouchMove={handleTouch}
        onTouchEnd={handleTouch}
        onTouchCancel={handleTouch}
    >
        <div 
            ref={scrollContainerRef}
            className="overflow-x-auto overflow-y-hidden pb-6 pt-4 custom-scrollbar relative"
            style={{ scrollBehavior: 'smooth', touchAction: 'pan-x' }}
        >
            <div className="inline-flex relative px-4 min-w-max">
                {whiteKeys.map((note) => (
                    <div key={note.note}>
                        <PianoKey 
                            ref={(el) => registerKey(note.note, el)}
                            noteData={note}
                            isActive={activeNotes.includes(note.note)}
                            onPlayStart={handlePlayStart}
                            onPlayStop={handlePlayStop}
                        />
                    </div>
                ))}

                {blackKeys.map((note) => {
                    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
                    const wkWidth = isMobile ? 2.5 : 3; 
                    const bkWidth = isMobile ? 1.5 : 2; 
                    
                    const nudge = 0;
                    const leftPos = (note.whiteKeyIndex * wkWidth) - (bkWidth / 2);

                    return (
                        <div 
                            key={note.note}
                            className="absolute top-0 z-10"
                            style={{ left: `${leftPos + nudge}rem` }}
                        >
                            <PianoKey 
                                ref={(el) => registerKey(note.note, el)}
                                noteData={note}
                                isActive={activeNotes.includes(note.note)}
                                onPlayStart={handlePlayStart}
                                onPlayStop={handlePlayStop}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
  );
});

export default Piano;
