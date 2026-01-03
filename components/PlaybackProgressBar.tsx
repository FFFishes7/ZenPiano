
import React, { useEffect, useRef } from 'react';
import { audioService } from '../services/audioService';
import { PianoStatus } from '../types';

interface PlaybackProgressBarProps {
  status: PianoStatus;
  totalDuration: number;
}

/**
 * High-performance Progress Bar
 * Uses direct DOM manipulation in a requestAnimationFrame loop
 * to avoid re-rendering the entire App component 60 times per second.
 */
export const PlaybackProgressBar: React.FC<PlaybackProgressBarProps> = React.memo(({ status, totalDuration }) => {
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // Only run the loop if playing or paused with valid duration
    if ((status !== PianoStatus.PLAYING_SONG && status !== PianoStatus.PAUSED) || totalDuration <= 0) {
      if (barRef.current && status === PianoStatus.IDLE) {
          barRef.current.style.width = '0%';
      }
      return;
    }

    const updateProgress = () => {
      if (!barRef.current) return;
      
      const current = audioService.getCurrentTime();
      const pct = Math.min((current / totalDuration) * 100, 100);
      
      // Directly update DOM style to bypass React render cycle
      barRef.current.style.width = `${pct}%`;
      
      rafRef.current = requestAnimationFrame(updateProgress);
    };

    rafRef.current = requestAnimationFrame(updateProgress);
    
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [status, totalDuration]);

  return (
    <div className="flex-none w-full h-1 bg-slate-200 relative z-50 mb-2 rounded-full overflow-hidden">
      <div
        ref={barRef}
        className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)] transition-all duration-100 linear"
        style={{ width: '0%' }}
      />
    </div>
  );
});
