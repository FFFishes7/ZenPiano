
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

  // CONTEXT LAYER: Managed by Tone.js / Browser

  // INSTANCE LAYER: Disposable components
  private sampler: Sampler | null = null;
  private reverb: Reverb | null = null;
  private compressor: Compressor | null = null;
  private output: Gain | null = null;
  
  public isLoaded = false;
  private _isSustainPedalDown = false;
  private currentQuality: AudioQuality = 'LIGHT';
  private _isAborting = false;

  // Cleanup all disposable resources (Instance Layer)
  private _disposeResources() {
    this.disposeSampler();

    if (this.reverb) { this.reverb.dispose(); this.reverb = null; }
    if (this.compressor) { this.compressor.dispose(); this.compressor = null; }
    if (this.output) { this.output.dispose(); this.output = null; }
  }
  
  // Public method to explicitly destroy the sampler instance (Stop logic)
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

  // Create a new Sampler instance from cached buffers
  private createSampler(): Sampler {
    if (this.sampler) return this.sampler; // Return existing if valid
    
    // Map buffers to a format Tone.Sampler accepts (note -> buffer)
    const bufferMap: Record<string, ToneAudioBuffer> = {};
    this.buffers.forEach((buffer, note) => {
        bufferMap[note] = buffer;
    });

    const sampler = new Sampler({
        urls: bufferMap, // Pass buffers directly!
        release: 1, 
        curve: "exponential",
        volume: -2,
    });
    
    if (this.output) {
        sampler.connect(this.output);
    }
    
    this.sampler = sampler;
    return sampler;
  }

  public cancelLoading() {
    this._isAborting = true;
    this._disposeResources();
    // Also clear buffers if loading is cancelled midway to ensure clean state?
    // Actually, keeping buffers is fine, but let's just clear for safety if it was partial.
    this.buffers.forEach(b => b.dispose());
    this.buffers.clear();
  }

  public async loadSamples(onProgress: (val: number) => void, quality: AudioQuality): Promise<void> {
    await this.ensureContext();
    this._disposeResources();
    // Do NOT clear this.buffers here if we want to support re-loading (switching quality)
    // But since we only have one quality now, let's clear to be safe or check diff.
    // For now, assume reload = fresh start.
    this.buffers.forEach(b => b.dispose());
    this.buffers.clear();

    this.currentQuality = 'LIGHT';
    this._isAborting = false;
    this.isLoaded = false;

    // Setup Effect Chain (Instance Layer - but long lived for the app session usually)
    // Actually, per rules, effects are part of context/graph. 
    // Let's keep them alive or recreate? 
    // The prompt says "Sampler / Synth / Voices" are disposable. 
    // Effects are usually expensive to recreate. Let's recreate them to be safe on "Import", 
    // or keep them. The rule says "Destroy all Sampler/Synth/Player".
    // It implies the "source" nodes. Effect chain can persist or be rebuilt.
    // Let's rebuild for maximum safety and cleanliness.
    
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
              
              // Store in Resource Layer
              this.buffers.set(task.note, new ToneAudioBuffer(audioBuffer));
              
            } catch (err) {
              console.warn(`Failed to load ${task.url}, skipping...`, err);
            }
            loadedCount++;
            onProgress((loadedCount / totalFiles) * 100);
        }));
    }

    if (this._isAborting) throw new Error("Loading cancelled by user.");

    // Pre-create the first sampler to verify everything works? 
    // Or just mark as loaded. The rule says "Sampler ... recreated per session".
    // So we don't need a sampler yet until we play.
    // BUT: Manual play needs a sampler! 
    // So we create a "Manual Play" sampler instance.
    this.createSampler();

    this.isLoaded = true;
    onProgress(100);
  }

  public async ensureContext() {
    if (getContext().state !== 'running') await start();
  }

  public startTone(note: string, velocity: number = 0.7) {
    if (!this.isLoaded) return;
    
    // Ensure sampler exists (auto-recreate if missing, e.g. after Stop)
    if (!this.sampler) this.createSampler();
    
    const ctx = getContext();
    if (ctx.state !== 'running') {
      start().catch(() => {}); 
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

  // Schedule Logic
  public scheduleEvents(events: { note: string; time: number; duration: number; velocity: number }[], onNoteStart: (n: string) => void, onNoteStop: (n: string) => void, onEnd: () => void) {
    // 1. Force Stop & Clean previous session
    this.resetPlayback(); 

    // 2. Create NEW Sampler instance for this session
    const sampler = this.createSampler();
    if (!sampler) return;
    
    getTransport().bpm.value = 120;
    let maxTime = 0;
    
    events.forEach(event => {
        const startTime = event.time;
        const endTime = event.time + event.duration;
        if (endTime > maxTime) maxTime = endTime;
        getTransport().schedule((time) => {
            sampler.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            getDraw().schedule(() => onNoteStart(event.note), time);
        }, startTime);
        getTransport().schedule((time) => {
            getDraw().schedule(() => onNoteStop(event.note), time);
        }, endTime);
    });
    getTransport().schedule((time) => getDraw().schedule(() => onEnd(), time), maxTime + 1);
  }

  public play() { if (getContext().state !== 'running') start(); getTransport().start(); }
  public pause() { getTransport().pause(); }
  
  // Implements: Stop -> Mute -> Destroy Instances -> Clear Transport
  public resetPlayback() { 
    // Stop Transport
    getTransport().stop(); 
    getTransport().cancel(); 
    
    // Destroy Sampler Instance
    this.disposeSampler();
  }
  
  // Legacy alias for compatibility (can be removed later)
  public stopSequence() { this.resetPlayback(); }
  
  public getCurrentTime(): number { return getTransport().seconds; }
}

export const audioService = new AudioService();
