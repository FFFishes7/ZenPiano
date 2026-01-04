
import React, { forwardRef } from 'react';
import { NoteDefinition } from '../types';

interface PianoKeyProps {
  noteData: NoteDefinition;
  onPlayStart: (note: NoteDefinition) => void;
  onPlayStop: (note: NoteDefinition) => void;
}

const PianoKey = React.memo(forwardRef<HTMLDivElement, PianoKeyProps>(({ noteData, onPlayStart, onPlayStop }, ref) => {
  const isWhite = noteData.type === 'white';
  
  // Use timestamp to ignore emulated mouse events after touch interaction
  const lastTouchTimeRef = React.useRef(0);

  const activeWhiteClasses = 'bg-slate-300 shadow-inner scale-[0.99] translate-y-1 border-slate-400';
  const inactiveWhiteClasses = 'bg-white shadow-md hover:shadow-lg hover:bg-slate-50';
  
  const activeBlackClasses = 'bg-black shadow-none scale-[0.99] translate-y-0.5 border-slate-900';
  const inactiveBlackClasses = 'shadow-xl bg-gradient-to-b from-slate-800 to-slate-900';

  // OPTIMIZATION: Always render as INACTIVE initially.
  // The 'active' state is now managed exclusively by the parent's RAF loop directly manipulating the DOM.
  // This bypasses React's render cycle latency and prevents state conflicts.
  const whiteClasses = `
    relative h-48 sm:h-64 landscape:h-32 md:landscape:h-64 w-10 sm:w-12 
    border border-slate-200 rounded-b-lg z-0 flex-shrink-0
    origin-top
    piano-key
    ${inactiveWhiteClasses}
  `;

  const blackClasses = `
    absolute h-28 sm:h-40 landscape:h-20 md:landscape:h-40 w-6 sm:w-8 
    rounded-b-md z-10 border-x border-b border-slate-800
    origin-top
    piano-key
    ${inactiveBlackClasses}
  `;

  const isTouchInteraction = () => {
    return Date.now() - lastTouchTimeRef.current < 1000;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      if (isTouchInteraction()) return;
      onPlayStart(noteData);
  };

  const handleMouseUp = (e: React.MouseEvent) => {
      if (isTouchInteraction()) return;
      onPlayStop(noteData);
  };
  
  const handleMouseLeave = (e: React.MouseEvent) => {
      if (isTouchInteraction()) return;
      onPlayStop(noteData);
  };

  const handleTouchStart = () => {
      lastTouchTimeRef.current = Date.now();
  };

  const handleTouchEnd = () => {
      lastTouchTimeRef.current = Date.now();
  };

  if (isWhite) {
    return (
      <div
        ref={ref}
        className={`${whiteClasses} flex items-end justify-center pb-3 cursor-pointer select-none group`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-note={noteData.note} 
      >
        {noteData.note.startsWith('C') && (
             <span className="text-[10px] text-slate-400 font-sans group-hover:text-slate-600 transition-colors">
                {noteData.note}
             </span>
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`${blackClasses} cursor-pointer select-none`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-note={noteData.note}
    >
        <div className="w-full h-full bg-gradient-to-b from-white/10 to-transparent rounded-b-md opacity-50 pointer-events-none"></div>
    </div>
  );
}));

export default PianoKey;
