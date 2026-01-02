
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
  getContext 
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
  // Single sampler instance (can be extended to multi-velocity layered samplers for better quality)
  // TODO: When implementing velocity layers, load multiple sample sets (e.g., pp, mf, ff)
  //       and select the most appropriate sampler based on velocity value for more realistic piano tone
  private sampler: Sampler | null = null;
  private objectUrls: string[] = [];
  private reverb: Reverb | null = null;
  private compressor: Compressor | null = null;
  private output: Gain | null = null;
  
  public isLoaded = false;
  private _isSustainPedalDown = false;
  private currentQuality: AudioQuality = 'LIGHT';
  private _isAborting = false;

  private _disposeResources() {
    if (this.sampler) {
      try { this.sampler.dispose(); } catch (e) {}
      this.sampler = null;
    }

    this.objectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    this.objectUrls = [];

    if (this.reverb) { this.reverb.dispose(); this.reverb = null; }
    if (this.compressor) { this.compressor.dispose(); this.compressor = null; }
    if (this.output) { this.output.dispose(); this.output = null; }
  }

  public cancelLoading() {
    this._isAborting = true;
    this._disposeResources();
  }

  public async loadSamples(onProgress: (val: number) => void, quality: AudioQuality): Promise<void> {
    await this.ensureContext();
    this._disposeResources();

    this.currentQuality = 'LIGHT';
    this._isAborting = false;
    this.isLoaded = false;

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
    const urlMap: Record<string, string> = {};
    
    const BATCH_SIZE = 8; 
    
    for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
        if (this._isAborting) throw new Error("Loading cancelled by user.");

        const batch = tasks.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (task) => {
            if (this._isAborting) return;
            try {
              const blob = await getCachedAudioBlob(task.url);
              
              // Check abort again before creating URL to prevent leak
              if (this._isAborting) return;

              const blobUrl = URL.createObjectURL(blob);
              this.objectUrls.push(blobUrl);
              urlMap[task.note] = blobUrl;
            } catch (err) {
              console.warn(`Failed to load ${task.url}, skipping...`, err);
            }
            loadedCount++;
            onProgress((loadedCount / totalFiles) * 100);
        }));
    }

    if (this._isAborting) throw new Error("Loading cancelled by user.");

    // Fix: Added timeout for Sampler loading to prevent indefinite hanging
    const SAMPLER_LOAD_TIMEOUT = 20000; // 20 seconds timeout for decoding/initialization

    // Use a controlled pattern to properly clean up sampler if timeout occurs
    let samplerInstance: Sampler | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isResolved = false;

    const sampler = await new Promise<Sampler>((resolve, reject) => {
        timeoutId = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                // Clean up the sampler instance if it was created but loading timed out
                if (samplerInstance) {
                    try {
                        samplerInstance.dispose();
                    } catch (e) {
                        // Ignore disposal errors
                    }
                }
                reject(new Error("Audio decoding timed out"));
            }
        }, SAMPLER_LOAD_TIMEOUT);

        samplerInstance = new Sampler({
            urls: urlMap,
            release: 1, // Default release
            curve: "exponential",
            volume: -2,
            onload: () => {
                if (!isResolved) {
                    isResolved = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(samplerInstance!);
                }
            },
            onerror: (e) => {
                console.error("Sampler Error", e);
                if (!isResolved) {
                    isResolved = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(samplerInstance!); // Still resolve to allow partial functionality
                }
            }
        });
        if (this.output) samplerInstance.connect(this.output);
    });

    this.sampler = sampler;
    this.isLoaded = true;
    onProgress(100);
  }

  public async ensureContext() {
    if (getContext().state !== 'running') await start();
  }

  public startTone(note: string, velocity: number = 0.7) {
    if (!this.isLoaded || !this.sampler) return;
    // Async ensure context starts, but don't block note triggering
    // If context is not running, start() will start ASAP after user interaction
    const ctx = getContext();
    if (ctx.state !== 'running') {
      start().catch(() => {}); // Silently handle start failure
    }
    this.sampler.triggerAttack(note, now(), velocity);
  }

  public stopTone(note: string) {
    if (this._isSustainPedalDown || !this.sampler) return;
    this.sampler.triggerRelease(note, now());
  }

  public setPedal(isDown: boolean) {
    this._isSustainPedalDown = isDown;
    if (!isDown && this.sampler) this.sampler.releaseAll();
  }

  public scheduleEvents(events: { note: string; time: number; duration: number; velocity: number }[], onNoteStart: (n: string) => void, onNoteStop: (n: string) => void, onEnd: () => void) {
    this.stopSequence();
    if (!this.sampler) return;
    
    getTransport().bpm.value = 120;
    let maxTime = 0;
    const sampler = this.sampler;
    
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
  public stopPlayback() { getTransport().stop(); if (this.sampler) this.sampler.releaseAll(); }
  public stopSequence() { getTransport().stop(); getTransport().cancel(); if (this.sampler) this.sampler.releaseAll(); }
  public getCurrentTime(): number { return getTransport().seconds; }
}

export const audioService = new AudioService();
