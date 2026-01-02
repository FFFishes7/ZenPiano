
import React, { forwardRef } from 'react';
import { NoteDefinition } from '../types';

interface PianoKeyProps {
  noteData: NoteDefinition;
  isActive: boolean;
  onPlayStart: (note: NoteDefinition) => void;
  onPlayStop: (note: NoteDefinition) => void;
}

const PianoKey = React.memo(forwardRef<HTMLDivElement, PianoKeyProps>(({ noteData, isActive, onPlayStart, onPlayStop }, ref) => {
  const isWhite = noteData.type === 'white';

  const whiteClasses = `
    relative h-48 sm:h-64 landscape:h-32 md:landscape:h-64 w-10 sm:w-12 
    bg-white border border-slate-200 rounded-b-lg z-0 flex-shrink-0
    transition-all duration-75 ease-out origin-top
    ${isActive 
      ? 'bg-slate-300 shadow-inner scale-[0.99] translate-y-1 border-slate-400' 
      : 'shadow-md hover:shadow-lg hover:bg-slate-50'
    }
  `;

  const blackClasses = `
    absolute h-28 sm:h-40 landscape:h-20 md:landscape:h-40 w-6 sm:w-8 
    bg-slate-900 rounded-b-md z-10 border-x border-b border-slate-800
    transition-all duration-75 ease-out origin-top
    ${isActive 
      ? 'bg-black shadow-none scale-[0.99] translate-y-0.5 border-slate-900' 
      : 'shadow-xl bg-gradient-to-b from-slate-800 to-slate-900'
    }
  `;

  const handleStart = (e: React.SyntheticEvent) => {
      // Prevent default to ensure touch events are handled by the parent glissando logic smoothly
      // but strictly speaking, the parent logic handles the heavy lifting now.
      if (e.type === 'touchstart') e.preventDefault();
      onPlayStart(noteData);
  };

  const handleStop = (e: React.SyntheticEvent) => {
      if (e.type === 'touchend') e.preventDefault();
      onPlayStop(noteData);
  };

  if (isWhite) {
    return (
      <div
        ref={ref}
        className={`${whiteClasses} flex items-end justify-center pb-3 cursor-pointer select-none group`}
        onMouseDown={handleStart}
        onMouseUp={handleStop}
        onMouseLeave={handleStop}
        onTouchStart={handleStart}
        onTouchEnd={handleStop}
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
      onMouseDown={handleStart}
      onMouseUp={handleStop}
      onMouseLeave={handleStop}
      onTouchStart={handleStart}
      onTouchEnd={handleStop}
      data-note={noteData.note}
    >
        <div className="w-full h-full bg-gradient-to-b from-white/10 to-transparent rounded-b-md opacity-50 pointer-events-none"></div>
    </div>
  );
}));

export default PianoKey;
