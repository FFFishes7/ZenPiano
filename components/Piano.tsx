
import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { PIANO_KEYS } from '../constants';
import { NoteDefinition, PianoStatus, FlatNoteEvent } from '../types';
import PianoKey from './PianoKey';
import { audioService } from '../services/audioService';
import { prepareNoteEvents, getMathematicallyActiveNotes } from '../utils/noteUtils';

function useIsMobile(breakpoint: number = 640): boolean {
  const [isMobile, setIsMobile] = useState(() => 
    typeof window !== 'undefined' && window.innerWidth < breakpoint
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

interface PianoProps {
  activeNotesRef: React.MutableRefObject<Map<string, number>>;
  onNoteStart: (note: string) => void;
  onNoteStop: (note: string) => void;
  status: PianoStatus;
  events: FlatNoteEvent[];
  maxDuration: number;
}

interface KeyRect {
  note: string;
  rect: DOMRect;
  isBlack: boolean;
}

const enum GestureScrollPermission {
  NONE = 'NONE',
  ALLOW = 'ALLOW',
  DENY = 'DENY'
}

const WHITE_ACTIVE_CLASSES = ['bg-slate-300', 'shadow-inner', 'scale-[0.99]', 'translate-y-1', 'border-slate-400'];
const WHITE_INACTIVE_CLASSES = ['bg-white', 'shadow-md', 'hover:shadow-lg', 'hover:bg-slate-50'];

const BLACK_ACTIVE_CLASSES = ['bg-black', 'shadow-none', 'scale-[0.99]', 'translate-y-0.5', 'border-slate-900'];
const BLACK_INACTIVE_CLASSES = ['shadow-xl', 'bg-gradient-to-b', 'from-slate-800', 'to-slate-900'];

const Piano: React.FC<PianoProps> = React.memo(({ 
    activeNotesRef, 
    onNoteStart, 
    onNoteStop, 
    status, 
    events,
    maxDuration 
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeTouchesRef = useRef<Map<number, string>>(new Map());
  const prevActiveNotesRef = useRef(new Set<string>());
  const isMobile = useIsMobile(640);
  const keysRef = useRef<Map<string, HTMLDivElement>>(new Map());
  
  const keyRectsRef = useRef<KeyRect[]>([]);
  const keyRectsDirtyRef = useRef(true); 
  const gestureScrollPermissionRef = useRef<GestureScrollPermission>(GestureScrollPermission.NONE);

  const statusRef = useRef(status);
  const onNoteStartRef = useRef(onNoteStart);
  const onNoteStopRef = useRef(onNoteStop);

  // --- USE SHARED PRE-PROCESSING ---
  const mappedEvents = useMemo(() => prepareNoteEvents(events), [events]);

  const eventsRef = useRef(mappedEvents);
  const maxDurationRef = useRef(maxDuration);

  useEffect(() => { 
      eventsRef.current = mappedEvents; 
  }, [mappedEvents]);

  useEffect(() => { 
      maxDurationRef.current = maxDuration; 
  }, [maxDuration]);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { onNoteStartRef.current = onNoteStart; }, [onNoteStart]);
  useEffect(() => { onNoteStopRef.current = onNoteStop; }, [onNoteStop]);
  
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const currentManualNotes = activeNotesRef.current;
      const prevNotes = prevActiveNotesRef.current;
      const keys = keysRef.current;
      const currentEvents = eventsRef.current;
      
      const currentTime = Math.max(0, audioService.getCurrentTime());
      
      const isActuallyPlaying = statusRef.current === PianoStatus.PLAYING_SONG;
      const isPausedMidSong = statusRef.current === PianoStatus.PAUSED && currentTime > 0.05;
      const shouldShowMathNotes = isActuallyPlaying || isPausedMidSong;

      const mathematicallyActiveNotes = shouldShowMathNotes 
        ? getMathematicallyActiveNotes(currentEvents, currentTime, maxDurationRef.current)
        : new Set<string>();

      let hasChanged = false;

      const updateKeyVisual = (note: string, isActive: boolean) => {
        const el = keys.get(note);
        if (!el) return;
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
        hasChanged = true;
      };

      const currentActiveSet = new Set([...currentManualNotes.keys(), ...mathematicallyActiveNotes]);
      
      // Lift keys no longer active
      prevNotes.forEach(note => {
          if (!currentActiveSet.has(note)) updateKeyVisual(note, false);
      });

      // Press keys now active
      currentActiveSet.forEach(note => {
          if (!prevNotes.has(note)) updateKeyVisual(note, true);
      });

      if (hasChanged || currentActiveSet.size !== prevNotes.size) {
          prevActiveNotesRef.current = currentActiveSet;
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    renderLoop();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const invalidateKeyRects = useCallback(() => {
    keyRectsDirtyRef.current = true;
  }, []);
  
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

  const keyBindingMap = useMemo(() => {
    const map = new Map<string, string>();
    PIANO_KEYS.forEach(k => { if (k.keyBinding) map.set(k.keyBinding, k.note); });
    return map;
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (statusRef.current === PianoStatus.PLAYING_SONG) return;
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    const note = keyBindingMap.get(key);
    if (note) onNoteStartRef.current(note);
  }, [keyBindingMap]);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    if (statusRef.current === PianoStatus.PLAYING_SONG) return;
    const key = event.key.toLowerCase();
    const note = keyBindingMap.get(key);
    if (note) onNoteStopRef.current(note);
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
        scrollContainerRef.current.scrollLeft = 1000;
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

  const registerKey = useCallback((note: string, el: HTMLDivElement | null) => {
    if (el) keysRef.current.set(note, el);
    else keysRef.current.delete(note);
  }, []);

  const cacheKeyRects = useCallback(() => {
    if (!keyRectsDirtyRef.current) return;
    const rects: KeyRect[] = [];
    keysRef.current.forEach((el, note) => {
      rects.push({ note, rect: el.getBoundingClientRect(), isBlack: note.includes('#') });
    });
    rects.sort((a, b) => a.isBlack === b.isBlack ? 0 : (a.isBlack ? -1 : 1));
    keyRectsRef.current = rects;
    keyRectsDirtyRef.current = false;
  }, []);

  const findHitKey = useCallback((cx: number, cy: number): string | null => {
    const hit = keyRectsRef.current.find(k => 
      cx >= k.rect.left && cx <= k.rect.right &&
      cy >= k.rect.top && cy <= k.rect.bottom
    );
    return hit?.note ?? null;
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      cacheKeyRects();
      if (statusRef.current === PianoStatus.PLAYING_SONG) {
        gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
        return;
      }
      Array.from(e.changedTouches).forEach(touch => {
          const hitKey = findHitKey(touch.clientX, touch.clientY);
          if (hitKey) {
            gestureScrollPermissionRef.current = GestureScrollPermission.DENY;
            onNoteStartRef.current(hitKey);
            activeTouchesRef.current.set(touch.identifier, hitKey);
          } else if (gestureScrollPermissionRef.current !== GestureScrollPermission.DENY && activeTouchesRef.current.size === 0) {
            gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
          }
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const permission = gestureScrollPermissionRef.current;
      if (permission === GestureScrollPermission.ALLOW || statusRef.current === PianoStatus.PLAYING_SONG) return;
      if (permission === GestureScrollPermission.DENY) {
        if (e.cancelable) e.preventDefault();
        const containerRect = container.getBoundingClientRect();
        Array.from(e.changedTouches).forEach(touch => {
            const oldNote = activeTouchesRef.current.get(touch.identifier);
            const cx = touch.clientX;
            const cy = touch.clientY;
            if (cx < containerRect.left || cx > containerRect.right || cy < containerRect.top || cy > containerRect.bottom) {
                if (oldNote) { onNoteStopRef.current(oldNote); activeTouchesRef.current.delete(touch.identifier); }
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
          if (note) { onNoteStopRef.current(note); activeTouchesRef.current.delete(touch.identifier); }
      });
      if (activeTouchesRef.current.size === 0) gestureScrollPermissionRef.current = GestureScrollPermission.NONE;
    };

    const releaseAllNotes = () => {
      activeTouchesRef.current.forEach(note => onNoteStopRef.current(note));
      activeTouchesRef.current.clear();
      gestureScrollPermissionRef.current = GestureScrollPermission.NONE;
    };

    const handleVisibilityChange = () => { if (document.hidden) releaseAllNotes(); };

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
  }, [cacheKeyRects, findHitKey]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let isDragging = false, startX = 0, scrollStartLeft = 0;

    const handleMouseDown = (e: MouseEvent) => {
      cacheKeyRects();
      const hitKey = findHitKey(e.clientX, e.clientY);
      if (statusRef.current === PianoStatus.PLAYING_SONG) {
        gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
        isDragging = true; startX = e.clientX; scrollStartLeft = container.scrollLeft;
        container.style.cursor = 'grabbing'; e.preventDefault(); return;
      }
      if (hitKey) { gestureScrollPermissionRef.current = GestureScrollPermission.DENY; return; }
      gestureScrollPermissionRef.current = GestureScrollPermission.ALLOW;
      isDragging = true; startX = e.clientX; scrollStartLeft = container.scrollLeft;
      container.style.cursor = 'grabbing'; e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => { if (isDragging) container.scrollLeft = scrollStartLeft - (e.clientX - startX); };
    const handleMouseUp = () => { isDragging = false; container.style.cursor = 'grab'; gestureScrollPermissionRef.current = GestureScrollPermission.NONE; };

    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [cacheKeyRects, findHitKey]);

  const whiteKeys = PIANO_KEYS.filter(k => k.type === 'white');
  const blackKeys = PIANO_KEYS.filter(k => k.type === 'black');

  return (
    <div className="w-full relative select-none bg-slate-100/50 border-t border-b border-slate-200 shadow-inner">
        <div ref={scrollContainerRef} className="overflow-x-auto overflow-y-hidden pb-16 pt-4 hide-scrollbar relative cursor-grab active:cursor-grabbing">
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
                    const wkWidth = isMobile ? 2.5 : 3, bkWidth = isMobile ? 1.5 : 2; 
                    const leftPos = (note.whiteKeyIndex * wkWidth) - (bkWidth / 2);
                    return (
                        <div key={note.note} className="absolute top-0 z-10" style={{ left: `${leftPos}rem` }}>
                            <PianoKey ref={(el) => registerKey(note.note, el)} noteData={note} onPlayStart={handlePlayStart} onPlayStop={handlePlayStop} />
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
  );
});

export default Piano;
