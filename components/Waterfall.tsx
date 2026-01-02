
import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { PIANO_KEYS } from '../constants';
import { audioService } from '../services/audioService';

interface FlatEvent {
    note: string;
    time: number;
    duration: number;
    velocity: number;
}

interface WaterfallProps {
    events: FlatEvent[];
    activeNotes: string[];
}

// Binary search to find the first event index that starts at or after the given time
const findStartIndex = (events: any[], time: number): number => {
    let low = 0;
    let high = events.length - 1;
    
    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid].time < time) {
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return low;
};

export const Waterfall: React.FC<WaterfallProps> = React.memo(({ events, activeNotes }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);
    
    const COLUMN_WIDTH = 22; 
    const KEYBOARD_HEIGHT = 80;
    const TOTAL_KEYS = 88;
    const TOTAL_WIDTH = TOTAL_KEYS * COLUMN_WIDTH;
    const PIXELS_PER_SECOND = 200; 

    const LATENCY_CORRECTION = 0.1;

    // PERFORMANCE OPTIMIZATION: Use useRef instead of useState for scroll position
    // to avoid triggering React re-renders on every scroll frame.
    const scrollLeftRef = useRef(TOTAL_WIDTH * 0.4); 
    
    const activeNotesRef = useRef(activeNotes);
    const isDraggingRef = useRef(false);
    const startXRef = useRef(0);
    const initialScrollRef = useRef(0);

    // Optimization: Pre-calculate key indices and Ensure Sorted by time for Binary Search
    const mappedEvents = useMemo(() => {
        return events.map(event => ({
            ...event,
            keyIndex: PIANO_KEYS.findIndex(k => k.note === event.note)
        }))
        .filter(e => e.keyIndex !== -1)
        .sort((a, b) => a.time - b.time); // Critical for binary search
    }, [events]);

    const eventsRef = useRef(mappedEvents);

    // Sync props to refs for the animation loop
    useEffect(() => { eventsRef.current = mappedEvents; }, [mappedEvents]);
    useEffect(() => { activeNotesRef.current = activeNotes; }, [activeNotes]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        if (!containerRef.current) return;
        const containerWidth = containerRef.current.clientWidth;
        const maxScroll = Math.max(0, TOTAL_WIDTH - containerWidth);
        
        // Update ref directly without triggering re-render
        scrollLeftRef.current = Math.min(Math.max(0, scrollLeftRef.current + delta), maxScroll);
    }, [TOTAL_WIDTH]);

    const handleStart = useCallback((clientX: number) => {
        isDraggingRef.current = true;
        startXRef.current = clientX;
        initialScrollRef.current = scrollLeftRef.current;
    }, []);

    const handleMove = useCallback((clientX: number) => {
        if (!isDraggingRef.current || !containerRef.current) return;
        const deltaX = clientX - startXRef.current;
        const containerWidth = containerRef.current.clientWidth;
        const maxScroll = Math.max(0, TOTAL_WIDTH - containerWidth);
        
        // Update ref directly without triggering re-render
        const nextScroll = Math.min(Math.max(0, initialScrollRef.current - deltaX), maxScroll);
        scrollLeftRef.current = nextScroll;
    }, [TOTAL_WIDTH]);

    const handleEnd = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        const updateDimensions = () => {
            if (!container || !canvas) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = container.getBoundingClientRect();
            
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            
            // Optimization: Reset transform before scaling to prevent cumulative errors
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
        };

        const resizeObserver = new ResizeObserver(updateDimensions);
        resizeObserver.observe(container);
        updateDimensions();
        
        const render = () => {
            const dpr = window.devicePixelRatio || 1;
            const width = canvas.width / dpr;
            const height = canvas.height / dpr;
            
            const currentScrollLeft = scrollLeftRef.current;
            const currentEvents = eventsRef.current;
            const currentActiveNotes = activeNotesRef.current;
            
            const currentTime = Math.max(0, audioService.getCurrentTime() - LATENCY_CORRECTION);

            ctx.fillStyle = '#f8fafc'; 
            ctx.fillRect(0, 0, width, height);

            const startKeyIndex = Math.floor(currentScrollLeft / COLUMN_WIDTH);
            const visibleKeysCount = Math.ceil(width / COLUMN_WIDTH) + 1;
            
            // Background Grid
            for (let i = 0; i < visibleKeysCount; i++) {
                const globalIndex = startKeyIndex + i;
                if (globalIndex < 0 || globalIndex >= TOTAL_KEYS) continue;

                const x = (globalIndex * COLUMN_WIDTH) - currentScrollLeft;
                const noteDef = PIANO_KEYS[globalIndex];
                
                if (noteDef.type === 'black') {
                    ctx.fillStyle = '#f1f5f9'; 
                    ctx.fillRect(x, 0, COLUMN_WIDTH, height - KEYBOARD_HEIGHT);
                } else {
                    ctx.strokeStyle = '#f1f5f9';
                    ctx.beginPath();
                    ctx.moveTo(x + COLUMN_WIDTH, 0);
                    ctx.lineTo(x + COLUMN_WIDTH, height - KEYBOARD_HEIGHT);
                    ctx.stroke();
                }
            }

            const hitLineY = height - KEYBOARD_HEIGHT;

            // --- OPTIMIZED NOTE RENDERING ---
            // 1. Calculate Time Window
            
            const viewDuration = hitLineY / PIXELS_PER_SECOND;
            const maxVisibleTime = currentTime + viewDuration + 0.5; // +0.5s buffer for notes entering top
            
            // Look back time: Allow for notes that started before currentTime but are long enough to still be visible.
            // 8 seconds is a generous buffer for very long sustain pedal usage.
            const minVisibleStartTime = currentTime - 8.0; 

            // 2. Binary Search to find start index
            const startIndex = findStartIndex(currentEvents, minVisibleStartTime);

            // 3. Iterate only through potentially visible notes
            for (let i = startIndex; i < currentEvents.length; i++) {
                const event = currentEvents[i];

                // Stop processing if the note starts after the top of the screen
                if (event.time > maxVisibleTime) break;

                const keyIndex = (event as any).keyIndex;
                const noteX = (keyIndex * COLUMN_WIDTH) - currentScrollLeft;
                
                // Horizontal Culling: Check if note is within horizontal view
                if (noteX + COLUMN_WIDTH < 0 || noteX > width) continue;

                const timeUntilHit = event.time - currentTime;
                const distanceToHit = timeUntilHit * PIXELS_PER_SECOND;
                
                const noteHeight = event.duration * PIXELS_PER_SECOND;
                const noteBottomY = hitLineY - distanceToHit;
                const noteTopY = noteBottomY - noteHeight;

                // Vertical Culling: Final safety check (though binary search handles most of this)
                if (noteTopY > hitLineY || noteBottomY < -50) continue;

                const noteDef = PIANO_KEYS[keyIndex];
                const isBlack = noteDef.type === 'black';

                ctx.fillStyle = isBlack ? '#7c3aed' : '#8b5cf6'; 
                
                const padding = 2;
                ctx.beginPath();
                ctx.roundRect(
                    noteX + padding, 
                    noteTopY, 
                    COLUMN_WIDTH - (padding * 2), 
                    noteHeight, 
                    4
                );
                ctx.fill();
            }

            // Hit line glow
            const lineGrad = ctx.createLinearGradient(0, hitLineY, 0, height);
            lineGrad.addColorStop(0, 'rgba(0,0,0,0.1)');
            lineGrad.addColorStop(0.1, 'rgba(0,0,0,0)');
            ctx.fillStyle = lineGrad;
            ctx.fillRect(0, hitLineY, width, 20);

            ctx.fillStyle = '#334155';
            ctx.fillRect(0, hitLineY, width, 1);

            // Bottom Keyboard
            for (let i = 0; i < visibleKeysCount; i++) {
                const globalIndex = startKeyIndex + i;
                if (globalIndex < 0 || globalIndex >= TOTAL_KEYS) continue;

                const x = (globalIndex * COLUMN_WIDTH) - currentScrollLeft;
                const noteDef = PIANO_KEYS[globalIndex];
                const isBlack = noteDef.type === 'black';
                const isActive = currentActiveNotes.includes(noteDef.note);

                const keyY = hitLineY + 1;
                const keyH = KEYBOARD_HEIGHT - 1;
                const bodyHeight = keyH - 4; 

                ctx.fillStyle = isActive ? (isBlack ? '#5b21b6' : '#8b5cf6') : (isBlack ? '#0f172a' : '#ffffff');
                ctx.fillRect(x, keyY, COLUMN_WIDTH - 1, bodyHeight);

                ctx.fillStyle = '#cbd5e1'; 
                ctx.fillRect(x + COLUMN_WIDTH - 1, keyY, 1, keyH);

                ctx.fillStyle = '#cbd5e1'; 
                ctx.fillRect(x, keyY + bodyHeight, COLUMN_WIDTH - 1, 4);

                if (noteDef.note.startsWith('C') && !noteDef.note.includes('#')) {
                    ctx.fillStyle = isActive || isBlack ? 'white' : '#94a3b8';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(noteDef.note, x + (COLUMN_WIDTH / 2), keyY + keyH - 10);
                }
            }

            rafRef.current = requestAnimationFrame(render);
        };

        rafRef.current = requestAnimationFrame(render);

        return () => {
             resizeObserver.disconnect();
             cancelAnimationFrame(rafRef.current);
        };
    }, [TOTAL_WIDTH]); 

    return (
        <div 
            ref={containerRef} 
            className="w-full h-full relative bg-slate-50 select-none overflow-hidden cursor-grab active:cursor-grabbing"
            onWheel={handleWheel}
            onMouseDown={(e) => handleStart(e.clientX)}
            onMouseMove={(e) => handleMove(e.clientX)}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={(e) => handleStart(e.touches[0].clientX)}
            onTouchMove={(e) => handleMove(e.touches[0].clientX)}
            onTouchEnd={handleEnd}
        >
            <canvas 
                ref={canvasRef} 
                className="block pointer-events-none" 
                style={{ width: '100%', height: '100%' }}
            />
        </div>
    );
});
