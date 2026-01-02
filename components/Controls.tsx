
import React, { useState, useRef } from 'react';
import { PianoStatus } from '../types';

interface ControlsProps {
  status: PianoStatus;
  onGenerate: (prompt: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onMidiUpload: (file: File) => void;
  songName?: string;
  songDescription?: string;
}

const Controls: React.FC<ControlsProps> = React.memo(({ 
    status, 
    onGenerate, 
    onPlay,
    onPause,
    onStop, 
    onMidiUpload, 
    songName, 
    songDescription 
}) => {
  const [prompt, setPrompt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim()) {
      onGenerate(prompt);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onMidiUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  const isLoading = status === PianoStatus.FETCHING_AI;
  const isPlaying = status === PianoStatus.PLAYING_SONG;
  const isPaused = status === PianoStatus.PAUSED;
  const isReady = status === PianoStatus.READY;
  const hasSong = isPlaying || isPaused || isReady;

  return (
    <div className="w-full max-w-xl mx-auto space-y-2">
      <div className="bg-white p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 transition-all flex flex-col justify-center overflow-hidden">
        {!hasSong && (
             <div className="flex justify-between items-center mb-2">
                <h2 className="text-sm sm:text-base font-medium text-slate-700 flex items-center gap-1.5">
                   <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                   </svg>
                   AI Composer
               </h2>
               <div>
                   <input 
                       type="file" 
                       accept=".mid,.midi" 
                       className="hidden" 
                       ref={fileInputRef}
                       onChange={handleFileChange}
                   />
                   <button 
                       type="button"
                       onClick={() => fileInputRef.current?.click()}
                       disabled={isLoading}
                       className="text-[10px] sm:text-xs font-medium text-slate-400 hover:text-indigo-600 uppercase tracking-wider flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                       </svg>
                       Import MIDI
                   </button>
               </div>
           </div>
        )}

        {!hasSong ? (
            <form onSubmit={handleSubmit} className="relative">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={isLoading}
                    placeholder="Describe a mood (e.g., 'Melancholic rain')"
                    className="w-full pl-3 pr-24 py-2.5 bg-slate-50 border-0 rounded-lg text-sm text-slate-700 placeholder:text-slate-400 focus:ring-1 focus:ring-indigo-200 focus:bg-white transition-all outline-none"
                />
                <div className="absolute right-1 top-1 bottom-1">
                    <button
                        type="submit"
                        disabled={isLoading || !prompt.trim()}
                        className={`h-full px-4 rounded-md text-xs sm:text-sm font-medium transition-all duration-200 flex items-center
                        ${isLoading 
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow'
                        }`}
                    >
                        {isLoading ? '...' : 'Compose'}
                    </button>
                </div>
            </form>
        ) : (
            <div className="flex items-center justify-between px-2 py-2">
                 <div className="flex-1 min-w-0 mr-4">
                    <h3 className="text-base sm:text-lg font-medium text-indigo-900 truncate">{songName || "Untitled"}</h3>
                    {songDescription && <p className="text-slate-500 italic text-xs truncate">"{songDescription}"</p>}
                 </div>

                 <div className="flex items-center gap-3 shrink-0">
                    <div className="hidden sm:block text-right mr-2">
                        {isPaused && <p className="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Paused</p>}
                        {isReady && <p className="text-[9px] text-slate-400 font-bold tracking-widest uppercase">Ready</p>}
                    </div>

                    {isPlaying ? (
                        <button
                            onClick={onPause}
                            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 flex items-center justify-center transition-colors shadow-sm ring-1 ring-indigo-100"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    ) : (
                        <button
                            onClick={onPlay}
                            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center pl-1"
                        >
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 sm:h-7 sm:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    )}

                    <button
                        onClick={onStop}
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200 flex items-center justify-center transition-colors"
                        title="Cancel / Exit"
                    >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                 </div>
            </div>
        )}
      </div>
      
      <div className="h-6 flex items-center justify-center">
        {isLoading && (
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-indigo-100 border-t-indigo-500 rounded-full animate-spin"></div>
                <span className="text-slate-500 text-xs animate-pulse">Composing...</span>
                <button 
                  onClick={onStop}
                  className="text-[9px] font-bold text-rose-400 hover:text-rose-600 uppercase border border-rose-100 px-1.5 rounded hover:bg-rose-50 ml-1"
                >
                  Cancel
                </button>
            </div>
        )}
      </div>

    </div>
  );
});

export default Controls;
