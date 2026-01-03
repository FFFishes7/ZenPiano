
import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { PIANO_KEYS } from '../constants';
import { NoteDefinition, PianoStatus } from '../types';
import PianoKey from './PianoKey';

// Custom hook for responsive mobile detection with resize listener
function useIsMobile(breakpoint: number = 640): boolean {
  const [isMobile, setIsMobile] = useState(() => 
    typeof window !== 'undefined' && window.innerWidth < breakpoint
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

interface PianoProps {
  activeNotesRef: React.MutableRefObject<Map<string, number>>; // Use fast path ref
  onNoteStart: (note: string) => void;
  onNoteStop: (note: string) => void;
  status: PianoStatus;
}

interface KeyRect {
  note: string;
  rect: DOMRect;
  isBlack: boolean;
}

// Gesture scroll permission states
const enum GestureScrollPermission {
  NONE = 'NONE',     // No active gesture
  ALLOW = 'ALLOW',   // Gesture started on scrollbar, allow scrolling
  DENY = 'DENY'      // Gesture started on keys, deny scrolling
}

// Key styling constants for direct DOM manipulation
const WHITE_ACTIVE_CLASSES = ['bg-slate-300', 'shadow-inner', 'scale-[0.99]', 'translate-y-1', 'border-slate-400'];
const WHITE_INACTIVE_CLASSES = ['bg-white', 'shadow-md', 'hover:shadow-lg', 'hover:bg-slate-50'];

const BLACK_ACTIVE_CLASSES = ['bg-black', 'shadow-none', 'scale-[0.99]', 'translate-y-0.5', 'border-slate-900'];
const BLACK_INACTIVE_CLASSES = ['shadow-xl', 'bg-gradient-to-b', 'from-slate-800', 'to-slate-900'];

const Piano: React.FC<PianoProps> = React.memo(({ activeNotesRef, onNoteStart, onNoteStop, status }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Tracks active touches: Map<TouchIdentifier, NoteName>
  const activeTouchesRef = useRef<Map<number, string>>(new Map());
  
  // Track previous state to avoid unnecessary DOM writes
  const prevActiveNotesRef = useRef(new Map<string, number>());
  
  // Responsive mobile detection - computed once and updated on resize
  const isMobile = useIsMobile(640);
  
  // 1. Ref Map: Stores direct DOM references to keys
  const keysRef = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // ... (existing Rect Cache and Gesture state refs) ...
  const keyRectsRef = useRef<KeyRect[]>([]);
  const keyRectsDirtyRef = useRef(true); 
  const gestureScrollPermissionRef = useRef<GestureScrollPermission>(GestureScrollPermission.NONE);

  // ... (existing refs for callbacks) ...
  const statusRef = useRef(status);
  const onNoteStartRef = useRef(onNoteStart);
  const onNoteStopRef = useRef(onNoteStop);
  
  // Animation Loop for Direct DOM Manipulation
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const currentNotes = activeNotesRef.current;
      const prevNotes = prevActiveNotesRef.current;
      const keys = keysRef.current;

      // PERFORMANCE OPTIMIZATION: Skip all logic if no notes are active and nothing changed
      if (currentNotes.size === 0 && prevNotes.size === 0) {
        animationFrameId = requestAnimationFrame(renderLoop);
        return;
      }
      
      const allInvolvedNotes = new Set([...currentNotes.keys(), ...prevNotes.keys()]);
      
      allInvolvedNotes.forEach(note => {
          const el = keys.get(note);
          if (!el) return;

          const isActive = (currentNotes.get(note) || 0) > 0;
          const wasActive = (prevNotes.get(note) || 0) > 0;

          if (isActive !== wasActive) {
              const isBlack = note.includes('#');
              const activeClasses = isBlack ? BLACK_ACTIVE_CLASSES : WHITE_ACTIVE_CLASSES;
              const inactiveClasses = isBlack ? BLACK_INACTIVE_CLASSES : WHITE_INACTIVE_CLASSES;

              if (isActive) {
                  el.classList.remove(...inactiveClasses);
                  el.classList.add(...activeClasses);
              } else {
                  el.classList.remove(...activeClasses);
                  el.classList.add(...inactiveClasses);
              }
          }
      });

      // Update prev state for next frame
      if (allInvolvedNotes.size > 0) {
          prevActiveNotesRef.current = new Map(currentNotes);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []); // Empty dependency array -> run once on mount

  // Keep refs in sync with props
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { onNoteStartRef.current = onNoteStart; }, [onNoteStart]);
  useEffect(() => { onNoteStopRef.current = onNoteStop; }, [onNoteStop]);
  
  // Function to invalidate cache
  const invalidateKeyRects = useCallback(() => {
    keyRectsDirtyRef.current = true;
  }, []);
  
  // Listen to resize and scroll to invalidate cache
  useEffect(() => {
    const container = scrollContainerRef.current;
    
    const handleResize = () => invalidateKeyRects();
    const handleScroll = () => invalidateKeyRects();
    
    window.addEventListener('resize', handleResize);
    container?.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('resize', handleResize);
      container?.removeEventListener('scroll', handleScroll);
    };
  }, [invalidateKeyRects]);

  // Optimization: Map key bindings for O(1) lookup in event handlers
  const keyBindingMap = useMemo(() => {
    const map = new Map<string, string>();
    PIANO_KEYS.forEach(k => {
      if (k.keyBinding) map.set(k.keyBinding, k.note);
    });
    return map;
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (statusRef.current === PianoStatus.PLAYING_SONG) return;
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const note = keyBindingMap.get(key);
    if (note) {
      onNoteStartRef.current(note);
    }
  }, [keyBindingMap]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (statusRef.current === PianoStatus.PLAYING_SONG) return;
    const key = event.key.toLowerCase();
    const note = keyBindingMap.get(key);
    if (note) {
      onNoteStopRef.current(note);
    }
  }, [keyBindingMap]);

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
      if (statusRef.current === PianoStatus.PLAYING_SONG) return;
      onNoteStartRef.current(noteData.note);
  }, []);
  
  const handlePlayStop = useCallback((noteData: NoteDefinition) => {
      if (statusRef.current === PianoStatus.PLAYING_SONG) return;
      onNoteStopRef.current(noteData.note);
  }, []);

  // Helper to register refs from PianoKey children
  const registerKey = useCallback((note: string, el: HTMLDivElement | null) => {
    if (el) keysRef.current.set(note, el);
    else keysRef.current.delete(note);
  }, []);

  // Helper to cache key rects - only recalculates if dirty
  const cacheKeyRects = useCallback(() => {
    if (!keyRectsDirtyRef.current) return; // Cache is valid, skip calculation
    
    const rects: KeyRect[] = [];
    keysRef.current.forEach((el, note) => {
      rects.push({
        note,
        rect: el.getBoundingClientRect(),
        isBlack: note.includes('#')
      });
    });
    // Sort: black keys first (higher z-index)
    rects.sort((a, b) => {
      if (a.isBlack === b.isBlack) return 0;
      return a.isBlack ? -1 : 1;
    });
    keyRectsRef.current = rects;
    keyRectsDirtyRef.current = false; // Mark cache as updated
  }, []);

  const findHitKey = useCallback((cx: number, cy: number): string | null => {
    const hit = keyRectsRef.current.find(k => 
      cx >= k.rect.left && cx <= k.rect.right &&
      cy >= k.rect.top && cy <= k.rect.bottom
    );
    return hit?.note ?? null;
  }, []);

  // Touch events on scrollContainer with conditional preventDefault
  // Key insight: gesture permission is determined ONLY at touchstart and never changes
  // Using refs to avoid re-binding event listeners on every status/callback change
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Cache key rects FIRST (before any hit detection)
      cacheKeyRects();
      
      // During song playback: allow scrolling but disable note triggering
      if (statusRef.current === PianoStatus.PLAYING_SONG) {
        gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
        return;
      }
      
      // Iterate through all changed touches (newly pressed fingers)
      Array.from(e.changedTouches).forEach(touch => {
          const cx = touch.clientX;
          const cy = touch.clientY;
          const hitKey = findHitKey(cx, cy);

          if (hitKey) {
            // If ANY touch starts on a key, we DENY scrolling for the session
            gestureScrollPermissionRef.current = GestureScrollPermission.DENY;
            
            // Play the note and track this specific touch ID
            onNoteStartRef.current(hitKey);
            activeTouchesRef.current.set(touch.identifier, hitKey);
          } else {
            // Touch started outside keys.
            // Only allow ALLOW if we aren't already DENYing (from another finger)
            // and no keys are currently being held.
            if (gestureScrollPermissionRef.current !== GestureScrollPermission.DENY && activeTouchesRef.current.size === 0) {
                 gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
            }
          }
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const permission = gestureScrollPermissionRef.current;
      
      // ALLOW: let browser handle scroll natively, do nothing
      if (permission === GestureScrollPermission.ALLOW) {
        return;
      }
      
      if (statusRef.current === PianoStatus.PLAYING_SONG) return;
      
      // DENY: prevent scroll and handle piano glissando
      if (permission === GestureScrollPermission.DENY) {
        if (e.cancelable) e.preventDefault(); // Prevent native scroll
        
        const containerRect = container.getBoundingClientRect();
        
        Array.from(e.changedTouches).forEach(touch => {
            const oldNote = activeTouchesRef.current.get(touch.identifier);
            // If this touch ID isn't tracking a note, it might have started on scrollbar
            // but we are now in DENY mode. We can choose to ignore it or let it pick up keys.
            // Let's let it pick up keys (glissando behavior).

            const cx = touch.clientX;
            const cy = touch.clientY;
            
            // Boundary detection
            const isOutOfBounds = cx < containerRect.left || cx > containerRect.right ||
                                  cy < containerRect.top || cy > containerRect.bottom;
            
            if (isOutOfBounds) {
                if (oldNote) {
                  onNoteStopRef.current(oldNote);
                  activeTouchesRef.current.delete(touch.identifier);
                }
                return;
            }
            
            const newNote = findHitKey(cx, cy);
            
            if (newNote && newNote !== oldNote) {
                if (oldNote) onNoteStopRef.current(oldNote);
                onNoteStartRef.current(newNote);
                activeTouchesRef.current.set(touch.identifier, newNote);
            } else if (!newNote && oldNote) {
                onNoteStopRef.current(oldNote);
                activeTouchesRef.current.delete(touch.identifier);
            }
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      Array.from(e.changedTouches).forEach(touch => {
          const note = activeTouchesRef.current.get(touch.identifier);
          if (note) {
              onNoteStopRef.current(note);
              activeTouchesRef.current.delete(touch.identifier);
          }
      });
      
      if (activeTouchesRef.current.size === 0) {
        gestureScrollPermissionRef.current = GestureScrollPermission.NONE;
      }
    };

    // Helper function to release all notes
    const releaseAllNotes = () => {
      activeTouchesRef.current.forEach(note => {
          onNoteStopRef.current(note);
      });
      activeTouchesRef.current.clear();
      gestureScrollPermissionRef.current = GestureScrollPermission.NONE;
    };

    // Handle page visibility change - prevent stuck notes when switching tabs or interrupted by phone calls
    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseAllNotes();
      }
    };

    // CRITICAL: touchmove must be { passive: false } to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [cacheKeyRects, findHitKey]); // Only depend on stable function refs

  // Mouse drag-to-scroll for PC (same logic as touch)
  // Using refs to avoid re-binding event listeners on every status change
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let isDragging = false;
    let startX = 0;
    let scrollStartLeft = 0;

    const handleMouseDown = (e: MouseEvent) => {
      // Cache key rects first
      cacheKeyRects();
      
      const hitKey = findHitKey(e.clientX, e.clientY);
      
      // During song playback: allow scrolling but disable note triggering
      if (statusRef.current === PianoStatus.PLAYING_SONG) {
        // Allow scrolling even when clicking on keyboard area
        gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
        isDragging = true;
        startX = e.clientX;
        scrollStartLeft = container.scrollLeft;
        container.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      
      if (hitKey) {
        // Click on key → let PianoKey handle it (mouse events on PianoKey still work)
        gestureScrollPermissionRef.current = GestureScrollPermission.DENY;
        return;
      }
      
      // Click outside keys → start drag scroll
      gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
      isDragging = true;
      startX = e.clientX;
      scrollStartLeft = container.scrollLeft;
      container.style.cursor = 'grabbing';
      e.preventDefault(); // Prevent text selection
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      container.scrollLeft = scrollStartLeft - dx;
    };

    const handleMouseUp = () => {
      isDragging = false;
      container.style.cursor = 'grab';
      gestureScrollPermissionRef.current = GestureScrollPermission.NONE;
    };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [cacheKeyRects, findHitKey]); // Only depend on stable function refs

  const whiteKeys = PIANO_KEYS.filter(k => k.type === 'white');
  const blackKeys = PIANO_KEYS.filter(k => k.type === 'black');

  return (
    <div 
        className="w-full relative select-none bg-slate-100/50 border-t border-b border-slate-200 shadow-inner"
    >
        <div 
            ref={scrollContainerRef}
            className="overflow-x-auto overflow-y-hidden pb-16 pt-4 hide-scrollbar relative cursor-grab active:cursor-grabbing"
        >
            <div className="inline-flex relative px-4 min-w-max">
                {whiteKeys.map((note) => (
                    <div key={note.note}>
                        <PianoKey 
                            ref={(el) => registerKey(note.note, el)}
                            noteData={note}
                            onPlayStart={handlePlayStart}
                            onPlayStop={handlePlayStop}
                        />
                    </div>
                ))}

                {blackKeys.map((note) => {
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
