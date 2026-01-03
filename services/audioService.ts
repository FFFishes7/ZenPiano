import { 
  Sampler, 
  Reverb, 
  Compressor, 
  Gain, 
  getDestination, 
  getTransport, 
  getDraw, 
  now, 
  start, 
  getContext,
  ToneAudioBuffer
} from 'tone';
import { AudioQuality } from '../types';

// --- CONFIGURATION ---
const FILE_EXT_LIGHT = "mp3"; 

const SAMPLED_NOTES = [
  "A0", "C1", "D#1", "F#1", "A1", 
  "C2", "D#2", "F#2", "A2", 
  "C3", "D#3", "F#3", "A3", 
  "C4", "D#4", "F#4", "A4", 
  "C5", "D#5", "F#5", "A5", 
  "C6", "D#6", "F#6", "A6", 
  "C7", "D#7", "F#7", "A7", 
  "C8"
];

async function fetchWithRetry(url: string, signal: AbortSignal, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { signal, mode: 'cors', cache: 'force-cache' });
      if (response.ok) return response;
      if (response.status === 404) throw new Error(`404 Not Found`);
    } catch (err: any) {
      if (i === retries - 1) throw err;
      if (err.name === 'AbortError') throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed after ${retries} attempts`);
}

async function getCachedAudioBlob(fullUrl: string): Promise<Blob> {
  const cacheName = 'zen-piano-salamander-light';
  
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(fullUrl);

    if (cachedResponse) {
      return await cachedResponse.blob();
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      const response = await fetchWithRetry(fullUrl, controller.signal);
      clearTimeout(timeoutId);

      try {
        await cache.put(fullUrl, response.clone());
      } catch (e) {
        console.warn("Cache storage failed", e);
      }

      return await response.blob();
    } catch (fetchError: any) {
      await cache.delete(fullUrl).catch(() => {});
      
      const message = fetchError.name === 'AbortError' 
        ? "Request timed out" 
        : fetchError.message;
        
      throw new Error(`${message} (File: ${fullUrl.split('/').pop()})`);
    }
  } catch (error: any) {
    throw error;
  }
}

class AudioService {
  // RESOURCE LAYER: Decoded AudioBuffers (Global Cache, never destroyed)
  private buffers: Map<string, ToneAudioBuffer> = new Map();

  // INSTANCE LAYER: Disposable components
  private sampler: Sampler | null = null;
  private reverb: Reverb | null = null;
  private compressor: Compressor | null = null;
  private output: Gain | null = null;

  // PLAYBACK DATA CACHE: Holds data for the next "Play" session
  private cachedEvents: { note: string; time: number; duration: number; velocity: number }[] = [];
  
  // ACTIVE SESSION STATE: Callbacks for the currently running (or paused) session
  private activeCallbacks: {
    onEnd: () => void;
    onClear: () => void;
  } | null = null;
  
  public isLoaded = false;
  private _isSustainPedalDown = false;
  private currentQuality: AudioQuality = 'LIGHT';
  private _isAborting = false;

  // Callback to notify UI when audio is passively suspended (e.g. backgrounded)
  private passivePauseHandler: (() => void) | null = null;

  constructor() {
    // Passive Suspend Handling: strictly follow the rule "distrust suspend"
    getContext().on('statechange', (state) => {
      if (state === 'suspended' || state === 'closed') {
        this.handlePassiveSuspend();
      }
    });

    // Reliable background detection for Safari/Mobile:
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.handlePassiveSuspend();
        } else {
          // ANTI-POP: Shield against residual audio leaking on Safari resume.
          if (this.output) {
              this.output.gain.cancelScheduledValues(now());
              this.output.gain.value = 0;
          }
        }
      });
    }
  }

  /**
   * Internal helper to handle passive suspension (from either statechange or visibilitychange)
   */
  private handlePassiveSuspend() {
    // 1. Immediate mute
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.value = 0; 
    }

    // 2. Immediate cleanup
    getTransport().pause();
    if (this.sampler) {
        try {
            this.sampler.releaseAll();
            this.sampler.disconnect();
        } catch (e) {}
    }
    this.disposeSampler();
    
    if (this.passivePauseHandler) {
        this.passivePauseHandler();
    }
  }

  /**
   * Register a handler to be called when the system suspends the audio.
   */
  public setPassivePauseHandler(handler: () => void) {
    this.passivePauseHandler = handler;
  }

  // Cleanup all disposable resources (Instance Layer)
  private _disposeResources() {
    this.disposeSampler();

    if (this.reverb) { this.reverb.dispose(); this.reverb = null; }
    if (this.compressor) { this.compressor.dispose(); this.compressor = null; }
    if (this.output) { this.output.dispose(); this.output = null; }
  }
  
  public disposeSampler() {
    if (this.sampler) {
      try { 
          this.sampler.releaseAll();
          this.sampler.disconnect();
          this.sampler.dispose(); 
      } catch (e) {
          console.warn("Error disposing sampler:", e);
      }
      this.sampler = null;
    }
  }

  private createSampler(): Sampler {
    if (this.sampler) return this.sampler; 
    
    const bufferMap: Record<string, ToneAudioBuffer> = {};
    this.buffers.forEach((buffer, note) => {
        bufferMap[note] = buffer;
    });

    const sampler = new Sampler({
        urls: bufferMap,
        release: 1, 
        curve: "exponential",
        volume: -2,
    });
    
    if (this.output) {
        sampler.connect(this.output);
    } else {
        // Fallback to destination if gain nodes are missing for some reason
        sampler.toDestination();
    }
    
    this.sampler = sampler;
    return sampler;
  }

  public cancelLoading() {
    this._isAborting = true;
    this._disposeResources();
    this.buffers.forEach(b => b.dispose());
    this.buffers.clear();
  }

  public async loadSamples(onProgress: (val: number) => void, quality: AudioQuality): Promise<void> {
    await this.ensureContext();
    this._disposeResources();
    this.buffers.forEach(b => b.dispose());
    this.buffers.clear();

    this.currentQuality = 'LIGHT';
    this._isAborting = false;
    this.isLoaded = false;

    // Build the effect chain (Master Gain is this.output)
    this.output = new Gain(0.8);
    this.compressor = new Compressor({ threshold: -20, ratio: 3, attack: 0.05, release: 0.25 });
    this.reverb = new Reverb({ decay: 3.5, preDelay: 0.01, wet: 0.35 });

    if (this.output && this.compressor && this.reverb) {
      this.output.chain(this.compressor, this.reverb, getDestination());
      await this.reverb.generate().catch(e => console.warn("Reverb gen failed", e));
    }

    interface LoadTask { note: string; url: string; }
    const tasks: LoadTask[] = [];
    
    const baseUrl = "https://tonejs.github.io/audio/salamander/";
    SAMPLED_NOTES.forEach(note => {
        const safeNote = note.replace('#', 's');
        tasks.push({ note, url: `${baseUrl}${safeNote}.${FILE_EXT_LIGHT}` });
    });

    const totalFiles = tasks.length;
    let loadedCount = 0;
    
    const BATCH_SIZE = 8; 
    
    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        if (this._isAborting) throw new Error("Loading cancelled by user.");

        const batch = tasks.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (task) => {
            if (this._isAborting) return;
            try {
              const blob = await getCachedAudioBlob(task.url);
              if (this._isAborting) return;

              const arrayBuffer = await blob.arrayBuffer();
              const audioBuffer = await getContext().decodeAudioData(arrayBuffer);
              this.buffers.set(task.note, new ToneAudioBuffer(audioBuffer));
            } catch (err) {
              console.warn(`Failed to load ${task.url}, skipping...`, err);
            }
            loadedCount++;
            onProgress((loadedCount / totalFiles) * 100);
        }));
    }

    if (this._isAborting) throw new Error("Loading cancelled by user.");

    // Resource layer ready. Instance layer starts with a fresh sampler for manual playing.
    this.createSampler();

    this.isLoaded = true;
    onProgress(100);
  }

  public async ensureContext() {
    if (getContext().state !== 'running') {
        try {
            await start();
        } catch (e) {
            console.warn("Tone.start() failed, context might still be suspended:", e);
        }
    }
  }

  public startTone(note: string, velocity: number = 0.7) {
    if (!this.isLoaded) return;
    if (!this.sampler) this.createSampler();
    
    this.ensureContext();

    // FORCE UNMUTE on manual key press
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.value = 0.8;
    }
    
    this.sampler?.triggerAttack(note, now(), velocity);
  }

  public stopTone(note: string) {
    if (this._isSustainPedalDown || !this.sampler) return;
    this.sampler.triggerRelease(note, now());
  }

  public setPedal(isDown: boolean) {
    this._isSustainPedalDown = isDown;
    if (!isDown && this.sampler) this.sampler.releaseAll();
  }

  /**
   * Import Phase: Strictly store data.
   */
  public scheduleEvents(
      events: { note: string; time: number; duration: number; velocity: number }[]
  ) {
    // Store data in the Service layer (Cache)
    this.cachedEvents = events;
    
    // Invalidate instance layer to force rebuild on next "Play"
    this.resetPlayback();
  }

  /**
   * Internal helper to perform the actual reconstruction and scheduling.
   * Called only when Play is triggered from a non-paused state.
   */
  private rebuildAndSchedule() {
    if (!this.activeCallbacks) return;

    // 1. Ensure absolute clean slate
    this.disposeSampler();
    getTransport().cancel();
    
    // 2. Fresh Instance Layer
    const sampler = this.createSampler();
    
    // 3. Instant volume for Playback start (No anti-pop as requested)
    if (this.output) {
        this.output.gain.value = 0.8;
    }
    
    // 4. Sync State: Clear existing manual visual states
    const { onEnd, onClear } = this.activeCallbacks;
    onClear();
    
    // 5. Schedule all notes on the Transport timeline
    getTransport().bpm.value = 120;
    let maxTime = 0;

    this.cachedEvents.forEach(event => {
        const startTime = event.time;
        const endTime = event.time + event.duration;
        if (endTime > maxTime) maxTime = endTime;
        
        // Audio: Always schedule.
        getTransport().schedule((time) => {
            sampler.triggerAttackRelease(event.note, event.duration, time, event.velocity);
        }, startTime);
    });
    
    getTransport().schedule((time) => getDraw().schedule(() => onEnd(), time), maxTime + 0.5);

    // 6. Trigger Fade-in after transport starts
    if (this.output) {
        // Slight delay ensuring audio thread has started
        setTimeout(() => {
            if (this.output) this.output.gain.rampTo(0.8, 0.15); // 150ms fade-in
        }, 10);
    }
  }

  public async play(callbacks?: {
      onEnd: () => void;
      onClear: () => void;
  }) { 
    await this.ensureContext();
    
    // If callbacks are provided, this is a FRESH play (not a resume).
    if (callbacks) {
        this.activeCallbacks = callbacks;
    }

    if (!this.sampler) {
        this.rebuildAndSchedule();
    }
    
    // FORCE UNMUTE on play
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.value = 0.8;
    }
    
    getTransport().start(); 
  }

  public pause() { 
    getTransport().pause(); 
    // Manual pause: Instant release, no gain ramping
    if (this.sampler) this.sampler.releaseAll();
  }
  
  public resetPlayback() { 
    // Synchronously mute to block noise leakage
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.value = 0;
    }

    getTransport().stop(); 
    getTransport().cancel(); 
    this.disposeSampler();
    this.activeCallbacks = null;
  }
  
  public stopSequence() { this.resetPlayback(); }
  public stopPlayback() { this.resetPlayback(); }
  
  public getCurrentTime(): number { return getTransport().seconds; }
}

export const audioService = new AudioService();