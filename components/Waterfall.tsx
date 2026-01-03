
import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { PIANO_KEYS } from '../constants';
import { audioService } from '../services/audioService';
import { FlatNoteEvent } from '../types';

interface WaterfallProps {
    events: FlatNoteEvent[];
    activeNotes: Map<string, number>;
    isPlaying: boolean;
    maxDuration: number;
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

export const Waterfall: React.FC<WaterfallProps> = React.memo(({ events, activeNotes, isPlaying, maxDuration }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gridCanvasRef = useRef<HTMLCanvasElement>(null); // Static grid layer
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
    // Initial value -1 means uninitialized, will be calculated based on container width on first render
    const scrollLeftRef = useRef(-1);
    const lastScrollLeftRef = useRef(-1); // Used to detect scroll changes
    
    // Cached visible keys count - only updated on resize
    const visibleKeysCountRef = useRef(0);
    
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
        
        // In paused state, manual rendering is required when scrolling
        if (!isPlayingRef.current && renderRef.current) {
            renderRef.current();
        }
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
        
        // In paused state, manual rendering is required when dragging
        if (!isPlayingRef.current && renderRef.current) {
            renderRef.current();
        }
    }, [TOTAL_WIDTH]);

    const handleEnd = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    // Store render function ref for animation control
    const renderRef = useRef<(() => void) | null>(null);
    const isPlayingRef = useRef(isPlaying);
    
    // Sync isPlaying to ref
    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const gridCanvas = gridCanvasRef.current;
        const container = containerRef.current;
        if (!canvas || !gridCanvas || !container) return;

        const ctx = canvas.getContext('2d', { alpha: true }); // Dynamic layer needs transparency
        const gridCtx = gridCanvas.getContext('2d', { alpha: false }); // Static layer doesn't need transparency
        if (!ctx || !gridCtx) return;

        // Draw static grid layer (defined early for use by updateDimensions)
        const renderGrid = (width: number, height: number, scrollLeft: number) => {
            gridCtx.fillStyle = '#f8fafc'; 
            gridCtx.fillRect(0, 0, width, height);

            const startKeyIndex = Math.floor(scrollLeft / COLUMN_WIDTH);
            const visibleKeysCount = visibleKeysCountRef.current;
            const hitLineY = height - KEYBOARD_HEIGHT;
            
            // Background Grid
            for (let i = 0; i < visibleKeysCount; i++) {
                const globalIndex = startKeyIndex + i;
                if (globalIndex < 0 || globalIndex >= TOTAL_KEYS) continue;

                const x = (globalIndex * COLUMN_WIDTH) - scrollLeft;
                const noteDef = PIANO_KEYS[globalIndex];
                
                if (noteDef.type === 'black') {
                    gridCtx.fillStyle = '#f1f5f9'; 
                    gridCtx.fillRect(x, 0, COLUMN_WIDTH, hitLineY);
                } else {
                    gridCtx.strokeStyle = '#f1f5f9';
                    gridCtx.beginPath();
                    gridCtx.moveTo(x + COLUMN_WIDTH, 0);
                    gridCtx.lineTo(x + COLUMN_WIDTH, hitLineY);
                    gridCtx.stroke();
                }
            }

            // Hit line glow
            const lineGrad = gridCtx.createLinearGradient(0, hitLineY, 0, height);
            lineGrad.addColorStop(0, 'rgba(0,0,0,0.1)');
            lineGrad.addColorStop(0.1, 'rgba(0,0,0,0)');
            gridCtx.fillStyle = lineGrad;
            gridCtx.fillRect(0, hitLineY, width, 20);

            gridCtx.fillStyle = '#334155';
            gridCtx.fillRect(0, hitLineY, width, 1);
            
            lastScrollLeftRef.current = scrollLeft;
        };

        const updateDimensions = () => {
            if (!container || !canvas || !gridCanvas) return;
            const dpr = window.devicePixelRatio || 1;
            const rect = container.getBoundingClientRect();
            
            // Update dimensions for both canvases
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            gridCanvas.width = rect.width * dpr;
            gridCanvas.height = rect.height * dpr;
            
            // Optimization: Reset transform before scaling to prevent cumulative errors
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            gridCtx.setTransform(1, 0, 0, 1, 0, 0);
            gridCtx.scale(dpr, dpr);
            
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            gridCanvas.style.width = `${rect.width}px`;
            gridCanvas.style.height = `${rect.height}px`;
            
            // Cache visible keys count - only changes on resize
            visibleKeysCountRef.current = Math.ceil(rect.width / COLUMN_WIDTH) + 1;
            
            // Calculate maximum scrollable range
            const maxScroll = Math.max(0, TOTAL_WIDTH - rect.width);
            
            // On first load, initialize scroll position to center (near C4)
            if (scrollLeftRef.current < 0) {
                // C4 is at key index 39 (counting from A0), center it in view
                const c4Index = 39;
                const centerPosition = (c4Index * COLUMN_WIDTH) - (rect.width / 2) + (COLUMN_WIDTH / 2);
                scrollLeftRef.current = Math.min(Math.max(0, centerPosition), maxScroll);
            } else {
                // On resize, ensure scroll position stays within bounds
                scrollLeftRef.current = Math.min(scrollLeftRef.current, maxScroll);
            }
            
            // Immediately render static grid layer synchronously to avoid black screen
            const width = rect.width;
            const height = rect.height;
            renderGrid(width, height, scrollLeftRef.current);
            
            // Synchronously render dynamic layer (if render function is defined)
            if (renderRef.current) {
                renderRef.current();
            }
        };

        const resizeObserver = new ResizeObserver(updateDimensions);
        resizeObserver.observe(container);
        updateDimensions();
        
        const render = () => {
            const dpr = window.devicePixelRatio || 1;
            const width = canvas.width / dpr;
            const height = canvas.height / dpr;
            
            // Ensure scroll position is within valid range
            const maxScroll = Math.max(0, TOTAL_WIDTH - width);
            const currentScrollLeft = Math.min(Math.max(0, scrollLeftRef.current), maxScroll);
            // Sync correct the ref value
            if (scrollLeftRef.current !== currentScrollLeft) {
                scrollLeftRef.current = currentScrollLeft;
            }
            
            const currentEvents = eventsRef.current;
            const currentActiveNotes = activeNotesRef.current;
            
            const currentTime = Math.max(0, audioService.getCurrentTime() - LATENCY_CORRECTION);

            // Only redraw static grid layer when scroll position changes
            if (currentScrollLeft !== lastScrollLeftRef.current) {
                renderGrid(width, height, currentScrollLeft);
            }

            // Clear dynamic layer
            ctx.clearRect(0, 0, width, height);

            const startKeyIndex = Math.floor(currentScrollLeft / COLUMN_WIDTH);
            const visibleKeysCount = visibleKeysCountRef.current;
            const hitLineY = height - KEYBOARD_HEIGHT;

            // --- OPTIMIZED NOTE RENDERING ---
            // Skip note rendering if no events
            if (currentEvents.length > 0) {
                // 1. Calculate Time Window
                
                const viewDuration = hitLineY / PIXELS_PER_SECOND;
                const maxVisibleTime = currentTime + viewDuration + 0.5; // +0.5s buffer for notes entering top
                
                // Use calculated maxDuration for look-back to ensure long notes are not culled incorrectly.
                const minVisibleStartTime = currentTime - (maxDuration + 2.0); 

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
            }

            // Bottom Keyboard (dynamic layer - needs to show activeNotes highlight)
            for (let i = 0; i < visibleKeysCount; i++) {
                const globalIndex = startKeyIndex + i;
                if (globalIndex < 0 || globalIndex >= TOTAL_KEYS) continue;

                const x = (globalIndex * COLUMN_WIDTH) - currentScrollLeft;
                const noteDef = PIANO_KEYS[globalIndex];
                const isBlack = noteDef.type === 'black';
                const isActive = (currentActiveNotes.get(noteDef.note) || 0) > 0;

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
            // Note: don't call requestAnimationFrame inside render, controlled externally
        };

        // Store render function for external animation control
        renderRef.current = render;

        // Render one frame immediately (ensure initial display)
        render();

        return () => {
             resizeObserver.disconnect();
             cancelAnimationFrame(rafRef.current);
             renderRef.current = null;
        };
    }, [TOTAL_WIDTH]); // Remove isPlaying dependency to avoid reinitializing canvas
    
    // Separate effect to control animation start/stop, won't cause canvas reinitialization
    useEffect(() => {
        if (isPlaying && renderRef.current) {
            // Start animation loop when playback begins
            const animate = () => {
                if (renderRef.current && isPlayingRef.current) {
                    renderRef.current();
                    rafRef.current = requestAnimationFrame(animate);
                }
            };
            rafRef.current = requestAnimationFrame(animate);
        } else {
            // Stop animation on pause, but keep current frame
            cancelAnimationFrame(rafRef.current);
            // Render one frame on pause to ensure correct display
            if (renderRef.current) {
                renderRef.current();
            }
        }
        
        return () => {
            cancelAnimationFrame(rafRef.current);
        };
    }, [isPlaying]); 

    return (
        <div 
            ref={containerRef} 
            className="w-full h-full relative bg-slate-50 select-none overflow-hidden cursor-grab active:cursor-grabbing"
            onWheel={handleWheel}
            onMouseDown={(e) => handleStart(e.clientX)}
            onMouseMove={(e) => handleMove(e.clientX)}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={(e) => e.touches.length > 0 && handleStart(e.touches[0].clientX)}
            onTouchMove={(e) => e.touches.length > 0 && handleMove(e.touches[0].clientX)}
            onTouchEnd={handleEnd}
        >
            {/* Static grid layer - bottom layer */}
            <canvas 
                ref={gridCanvasRef} 
                className="absolute inset-0 block pointer-events-none" 
                style={{ width: '100%', height: '100%' }}
            />
            {/* Dynamic notes+keyboard layer - top layer */}
            <canvas 
                ref={canvasRef} 
                className="absolute inset-0 block pointer-events-none" 
                style={{ width: '100%', height: '100%' }}
            />
        </div>
    );
});
