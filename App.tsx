import React, { useState, useCallback, useRef, useEffect } from 'react';
import Piano from './components/Piano';
import Controls from './components/Controls';
import { Waterfall } from './components/Waterfall';
import { PlaybackProgressBar } from './components/PlaybackProgressBar';
import { audioService } from './services/audioService';
import { useNotePlayer } from './hooks/useNotePlayer';
import { useSongPlayer } from './hooks/useSongPlayer';
import { PianoStatus, ViewMode, AudioQuality } from './types';

const App: React.FC = () => {
  // ==================== Audio Loading State ====================
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isSamplesLoaded, setIsSamplesLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioQuality, setAudioQuality] = useState<AudioQuality | null>(null);
  const [isMounting, setIsMounting] = useState(false);

  // ==================== UI State ====================
  const [dragActive, setDragActive] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('PIANO');
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Performance Optimization: Use refs for scroll positions to avoid re-renders on scroll.
  // We only need to read these values when switching views (mounting/unmounting).
  const pianoScrollRef = useRef<number | null>(null);
  const waterfallScrollRef = useRef<number | null>(null);

  const handlePianoScroll = useCallback((value: number) => {
    pianoScrollRef.current = value;
  }, []);

  const handleWaterfallScroll = useCallback((value: number) => {
    waterfallScrollRef.current = value;
  }, []);

  // ==================== Shared Note State ====================
  // FAST PATH: Ref for immediate visual updates (bypassing React render cycle)
  const activeNotesRef = useRef<Map<string, number>>(new Map());

  const clearAllNotes = useCallback(() => {
    activeNotesRef.current.clear(); // Clear fast path immediately
  }, []);

  // ==================== Use Hooks ====================
  // Song Player Hook
  const {
    status,
    currentSong,
    flatEvents,
    handleGenerateAndPlay: rawHandleGenerateAndPlay,
    handleMidiUpload: rawHandleMidiUpload,
    handlePlay,
    handlePause,
    handleStop: songPlayerStop,
    totalDuration,
  } = useSongPlayer({
    activeNotesRef, // Pass fast path ref
    clearAllNotes,
  });

  const handleGenerateAndPlay = useCallback(async (prompt: string) => {
    setGenerationError(null);
    try {
      await rawHandleGenerateAndPlay(prompt);
    } catch (err: any) {
      setGenerationError(err.message || 'Generation failed');
    }
  }, [rawHandleGenerateAndPlay]);

  const handleMidiUpload = useCallback(async (file: File) => {
    setGenerationError(null);
    try {
      await rawHandleMidiUpload(file);
    } catch (err: any) {
      setGenerationError(err.message || 'MIDI upload failed');
    }
  }, [rawHandleMidiUpload]);

  // Note Player Hook
  const { handleNoteStart, handleNoteStop } = useNotePlayer({
    status,
    activeNotesRef, // Pass fast path ref
  });

  // ==================== Audio Loading Logic ====================
  const startLoading = useCallback((quality: AudioQuality) => {
    setAudioQuality(quality);
    setLoadError(null);
    const load = async () => {
      try {
        await audioService.loadSamples((progress) => {
          setLoadingProgress(Math.floor(progress));
        }, quality);
        setTimeout(() => {
          setIsSamplesLoaded(true);
        }, 500);
      } catch (err: any) {
        console.error('Audio Load Error:', err.message);
        if (err.message !== 'Loading cancelled by user.') {
          setLoadError(err.message || 'Failed to load audio resources.');
        } else {
          setAudioQuality(null);
          setLoadingProgress(0);
        }
      }
    };
    load();
  }, []);

  const handleCancelLoading = useCallback(() => {
    audioService.cancelLoading();
    setAudioQuality(null);
    setLoadingProgress(0);
    setLoadError(null);
    setIsMounting(true);
    setTimeout(() => setIsMounting(false), 300);
  }, []);

  // ==================== Stop Playback (Reset View Mode) ====================
  const handleStop = useCallback(() => {
    songPlayerStop();
    setGenerationError(null);
  }, [songPlayerStop]);

  // ==================== Drag and Drop Handling ====================
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
          handleMidiUpload(file);
        }
      }
    },
    [handleMidiUpload]
  );

  // ==================== View Switch ====================
  const toggleViewMode = useCallback(
    () => setViewMode((prev) => (prev === 'PIANO' ? 'WATERFALL' : 'PIANO')),
    []
  );

  // ==================== Render: Audio Quality Selection Page ====================
  if (!audioQuality) {
    return (
      <div
        className={`fixed-safe bg-slate-50 flex flex-col items-center justify-center z-50 p-4 ${
          isMounting ? 'pointer-events-none' : ''
        }`}
      >
        <div className="text-center space-y-8">
          <h1 className="text-4xl font-thin text-slate-800">
            Zen<span className="font-normal text-slate-400">Piano</span>
          </h1>
          <button
            onClick={() => startLoading('LIGHT')}
            className="px-10 py-3 bg-white border border-slate-200 rounded-full shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 text-slate-600 text-[11px] font-medium tracking-[0.2em] uppercase"
          >
            Enter Piano
          </button>
        </div>
      </div>
    );
  }

  // ==================== Render: Loading Page ====================
  if (!isSamplesLoaded) {
    return (
      <div className="fixed-safe bg-white flex flex-col items-center justify-center z-50">
        <div className="w-64 space-y-6">
          <h1 className="text-2xl font-light text-center tracking-widest text-slate-800 uppercase">
            {loadError ? 'Error' : 'Tuning'}
          </h1>
          
          {loadError ? (
            <div className="flex flex-col items-center gap-6">
              <p className="text-center text-xs text-rose-500 font-mono px-2 leading-relaxed">
                {loadError}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => audioQuality && startLoading(audioQuality)}
                  className="px-6 py-2 bg-slate-800 text-white text-[10px] font-bold rounded-full uppercase tracking-widest hover:bg-slate-700 transition-colors duration-200 shadow-sm"
                >
                  Retry
                </button>
                <button
                  onClick={handleCancelLoading}
                  className="px-6 py-2 border border-slate-200 text-[10px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-full uppercase tracking-widest transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="w-full bg-slate-100 h-0.5 overflow-hidden">
                <div
                  className="bg-slate-800 h-full transition-all duration-300"
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
              <div className="flex flex-col items-center gap-4">
                <p className="text-center text-xs text-slate-400 font-mono">Loading assets...</p>
                <button
                  onClick={handleCancelLoading}
                  className="px-4 py-1.5 border border-rose-100 text-[10px] font-bold text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-full uppercase tracking-widest hover:transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ==================== Render: Main Application Interface ====================
  return (
    <div
      className="h-screen-safe w-full bg-slate-50 flex flex-col overflow-hidden relative"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      {/* Drag and Drop Hint Layer */}
      {dragActive && (
        <div className="absolute inset-0 bg-white/90 z-[60] flex items-center justify-center border-4 border-dashed border-slate-300 m-4 rounded-xl pointer-events-none">
          <p className="text-3xl font-thin text-slate-500">DROP MIDI FILE HERE</p>
        </div>
      )}

      {/* Logo */}
      <div className="absolute top-2 left-6 z-40 pointer-events-none opacity-80 landscape:opacity-0 md:landscape:opacity-80 transition-opacity">
        <h1 className="text-xl font-thin text-slate-800 tracking-tight">
          Zen<span className="font-normal text-slate-400">Piano</span>
        </h1>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col w-full max-w-[90rem] mx-auto px-4 min-h-0 relative z-0 pt-14 landscape:pt-2 pb-2">
        {/* View Switch Button */}
        <div className="flex-none flex justify-end w-full max-w-7xl h-10 landscape:h-8 items-start mb-2 landscape:mb-1">
            <button
              onClick={toggleViewMode}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow text-xs text-slate-600 transition-all z-50"
            >
              {viewMode === 'PIANO' ? (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16m-7 6h7"
                    />
                  </svg>
                  Switch to Waterfall
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
                    />
                  </svg>
                  Switch to Piano
                </>
              )}
            </button>
        </div>

        {/* Piano/Waterfall View */}
        <div className="flex-1 w-full min-h-0 relative flex flex-col bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden mb-2 landscape:mb-1">
          {viewMode === 'PIANO' ? (
            <div className="h-full w-full overflow-hidden flex flex-col justify-center bg-slate-100/50">
              <Piano
                activeNotesRef={activeNotesRef} // Pass fast path ref
                onNoteStart={handleNoteStart}
                onNoteStop={handleNoteStop}
                status={status}
                events={flatEvents}
                maxDuration={currentSong?.maxDuration || 0}
                initialScrollLeft={pianoScrollRef.current}
                onScrollChange={handlePianoScroll}
              />
            </div>
          ) : (
            <Waterfall
              events={flatEvents}
              activeNotesRef={activeNotesRef} // Pass fast path ref
              isPlaying={status === PianoStatus.PLAYING_SONG}
              maxDuration={currentSong?.maxDuration || 0}
              initialScrollLeft={waterfallScrollRef.current}
              onScrollChange={handleWaterfallScroll}
              pixelsPerSecond={(() => {
                  const baseBpm = 120;
                  const baseSpeed = 200;
                  const currentBpm = currentSong?.tempo || baseBpm;
                  const rawSpeed = (currentBpm / baseBpm) * baseSpeed;
                  // Clamp between 80 and 400 to ensure usability
                  return Math.min(Math.max(rawSpeed, 80), 400);
              })()}
            />
          )}
        </div>

        {/* Progress Bar */}
        <PlaybackProgressBar 
          status={status}
          totalDuration={totalDuration}
        />

        {/* Control Panel */}
        <div className="flex-none w-full z-10 bg-slate-50 shrink-0">
          <Controls
            status={status}
            onGenerate={handleGenerateAndPlay}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
            onMidiUpload={handleMidiUpload}
            songName={currentSong?.songName}
            songDescription={currentSong?.description}
            error={generationError}
          />
        </div>
      </main>
    </div>
  );
};

export default App;
