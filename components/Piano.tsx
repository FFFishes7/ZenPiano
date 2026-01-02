
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

// Gesture scroll permission states
const enum GestureScrollPermission {
  NONE = 'NONE',     // No active gesture
  ALLOW = 'ALLOW',   // Gesture started on scrollbar, allow scrolling
  DENY = 'DENY'      // Gesture started on keys, deny scrolling
}

const Piano: React.FC<PianoProps> = React.memo(({ activeNotes, onNoteStart, onNoteStop, status }) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastNoteRef = useRef<string | null>(null);
  
  // 1. Ref Map: Stores direct DOM references to keys
  const keysRef = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // 2. Rect Cache: Stores geometric data calculated on touchstart
  const keyRectsRef = useRef<KeyRect[]>([]);
  
  // 3. Gesture state: scroll permission determined at touchstart (immutable during gesture)
  const gestureScrollPermissionRef = useRef<GestureScrollPermission>(GestureScrollPermission.NONE);

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

  // Helper to cache key rects and check if point hits a key
  const cacheKeyRects = useCallback(() => {
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
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (status === PianoStatus.PLAYING_AI) return;
      
      // Cache key rects FIRST (before any hit detection)
      cacheKeyRects();
      
      const touch = e.touches[0];
      const cx = touch.clientX;
      const cy = touch.clientY;
      
      // Determine permission based on whether touch hits a key
      const hitKey = findHitKey(cx, cy);
      
      // DEBUG: Log touch start info
      console.log('🎹 TOUCH START', {
        x: cx,
        y: cy,
        hitKey,
        target: (e.target as HTMLElement).tagName,
        targetClass: (e.target as HTMLElement).className?.slice(0, 50),
      });
      
      if (hitKey) {
        // Touch started on a key → DENY scroll, enable piano glissando
        gestureScrollPermissionRef.current = GestureScrollPermission.DENY;
        console.log('🔴 Permission: DENY (on key)');
        onNoteStart(hitKey);
        lastNoteRef.current = hitKey;
      } else {
        // Touch started outside keys (scrollbar/padding) → ALLOW scroll
        gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
        console.log('🟢 Permission: ALLOW (outside keys)');
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (status === PianoStatus.PLAYING_AI) return;
      
      const permission = gestureScrollPermissionRef.current;
      const touch = e.touches[0];
      
      // DEBUG: Log first few moves
      console.log('👆 TOUCH MOVE', {
        permission,
        x: touch.clientX,
        y: touch.clientY,
        scrollLeft: container.scrollLeft,
      });
      
      // ALLOW: let browser handle scroll natively, do nothing
      if (permission === GestureScrollPermission.ALLOW) {
        console.log('  → Letting browser scroll');
        return;
      }
      
      // DENY: prevent scroll and handle piano glissando
      if (permission === GestureScrollPermission.DENY) {
        e.preventDefault(); // This works because passive: false
        console.log('  → preventDefault called');
        
        const cx = touch.clientX;
        const cy = touch.clientY;
        
        const note = findHitKey(cx, cy);
        
        if (note && note !== lastNoteRef.current) {
          if (lastNoteRef.current) onNoteStop(lastNoteRef.current);
          onNoteStart(note);
          lastNoteRef.current = note;
        } else if (!note && lastNoteRef.current) {
          onNoteStop(lastNoteRef.current);
          lastNoteRef.current = null;
        }
      }
    };

    const handleTouchEnd = () => {
      console.log('🏁 TOUCH END', { permission: gestureScrollPermissionRef.current });
      if (lastNoteRef.current) {
        onNoteStop(lastNoteRef.current);
        lastNoteRef.current = null;
      }
      gestureScrollPermissionRef.current = GestureScrollPermission.NONE;
    };

    // CRITICAL: touchmove must be { passive: false } to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [status, onNoteStart, onNoteStop, cacheKeyRects, findHitKey]);

  // Mouse drag-to-scroll for PC (same logic as touch)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let isDragging = false;
    let startX = 0;
    let scrollStartLeft = 0;

    const handleMouseDown = (e: MouseEvent) => {
      if (status === PianoStatus.PLAYING_AI) return;
      
      // Cache key rects first
      cacheKeyRects();
      
      const hitKey = findHitKey(e.clientX, e.clientY);
      
      console.log('🖱️ MOUSE DOWN', { hitKey, x: e.clientX, y: e.clientY });
      
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
      console.log('🖱️ MOUSE MOVE drag', { dx, scrollLeft: container.scrollLeft });
    };

    const handleMouseUp = () => {
      if (isDragging) {
        console.log('🖱️ MOUSE UP drag end');
      }
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
  }, [status, cacheKeyRects, findHitKey]);

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
