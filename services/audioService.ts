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
const FILE_EXT_LIGHT = "ogg"; 

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
  const cacheName = 'zen-piano-salamander-light-v2-ogg';
  try {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(fullUrl);
    if (cachedResponse) return await cachedResponse.blob();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetchWithRetry(fullUrl, controller.signal);
      clearTimeout(timeoutId);
      try { await cache.put(fullUrl, response.clone()); } catch (e) {}
      return await response.blob();
    } catch (fetchError: any) {
      await cache.delete(fullUrl).catch(() => {});
      throw new Error(fetchError.message);
    }
  } catch (error: any) { throw error; }
}

class AudioService {
  private buffers: Map<string, ToneAudioBuffer> = new Map();
  private sampler: Sampler | null = null;
  private reverb: Reverb | null = null;
  private compressor: Compressor | null = null;
  private output: Gain | null = null;
  private cachedEvents: { note: string; time: number; duration: number; velocity: number }[] = [];
  private activeCallbacks: { onEnd: () => void; onClear: () => void; } | null = null;
  public isLoaded = false;
  private _isSustainPedalDown = false;
  private currentQuality: AudioQuality = 'LIGHT';
  private _isAborting = false;
  private passivePauseHandler: (() => void) | null = null;

  constructor() {
    getContext().on('statechange', (state) => {
      if (state === 'suspended' || state === 'closed') this.handlePassiveSuspend();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.handlePassiveSuspend();
        } else {
          this.mute(); 
        }
      });
    }
  }

  private handlePassiveSuspend() {
    this.mute();
    getTransport().pause();
    if (this.sampler) {
        try { 
            const originalRelease = this.sampler.release;
            this.sampler.release = 0;
            this.sampler.releaseAll();
            this.sampler.release = originalRelease;
            this.sampler.volume.value = -100;
        } catch (e) {}
    }
    if (this.passivePauseHandler) this.passivePauseHandler();
  }

  public setPassivePauseHandler(handler: () => void) { this.passivePauseHandler = handler; }

  private _disposeResources() {
    this.mute();
    getTransport().stop();
    getTransport().cancel(0);
  }
  
  public disposeSampler() {
    if (this.sampler) {
      this.sampler.releaseAll();
      this.sampler.volume.value = -100;
    }
  }

  private createSampler(): Sampler {
    if (this.sampler) return this.sampler; 
    const bufferMap: Record<string, ToneAudioBuffer> = {};
    this.buffers.forEach((buffer, note) => { bufferMap[note] = buffer; });
    this.sampler = new Sampler({ urls: bufferMap, release: 1, curve: "exponential", volume: -100 });
    this.ensureEffectChain();
    return this.sampler;
  }

  private ensureEffectChain() {
      if (!this.output) this.output = new Gain(0);
      if (!this.compressor) this.compressor = new Compressor({ threshold: -20, ratio: 3, attack: 0.05, release: 0.25 });
      if (!this.reverb) this.reverb = new Reverb({ decay: 3.5, preDelay: 0.01, wet: 0 });

      if (this.sampler) {
          this.sampler.disconnect();
          this.sampler.connect(this.output);
      }
      this.output.disconnect();
      this.output.chain(this.compressor, this.reverb, getDestination());
  }

  public cancelLoading() {
    this._isAborting = true;
    this.mute();
  }

  public async loadSamples(onProgress: (val: number) => void, quality: AudioQuality): Promise<void> {
    // 1. PHYSICAL LOCK: Mute the entire destination immediately
    getDestination().mute = true;
    
    // 2. LOGICAL KILL: Stop transport, clear events, and silence sampler
    this.resetPlayback(); 
    
    await this.ensureContext();
    
    // 3. RESOURCE RESET
    this.buffers.forEach(b => b.dispose());
    this.buffers.clear();
    this._isAborting = false;
    this.isLoaded = false;

    if (!this.output) this.output = new Gain(0);
    this.ensureEffectChain();

    const tasks: { note: string; url: string; }[] = [];
    const baseUrl = "https://tonejs.github.io/audio/salamander/";
    SAMPLED_NOTES.forEach(note => {
        const safeNote = note.replace('#', 's');
        tasks.push({ note, url: `${baseUrl}${safeNote}.${FILE_EXT_LIGHT}` });
    });

    const totalFiles = tasks.length;
    let loadedCount = 0;
    for (let i = 0; i < totalFiles; i += 4) {
        if (this._isAborting) break;
        const batch = tasks.slice(i, i + 4);
        await Promise.all(batch.map(async (task) => {
            try {
              const blob = await getCachedAudioBlob(task.url);
              const arrayBuffer = await blob.arrayBuffer();
              const audioBuffer = await getContext().decodeAudioData(arrayBuffer);
              this.buffers.set(task.note, new ToneAudioBuffer(audioBuffer));
            } catch (err: any) {
               // Propagate error to stop the loading process
               if (this._isAborting) return; // Ignore if we are already cancelling
               throw err;
            }
            loadedCount++;
            onProgress((loadedCount / totalFiles) * 100);
        }));
    }
    
    if (this.sampler) {
        // Correctly add each buffer to the existing sampler
        this.buffers.forEach((buffer, note) => {
            this.sampler?.add(note as any, buffer);
        });
    } else {
        this.createSampler();
    }
    
    this.isLoaded = true;
    onProgress(100);
    setTimeout(() => { getDestination().mute = false; }, 100);
  }

  public async ensureContext() {
    if (getContext().state !== 'running') {
        try { await start(); } catch (e) {}
    }
  }

  public startTone(note: string, velocity: number = 0.7) {
    if (!note || !this.isLoaded) return;
    if (!this.sampler) this.createSampler();
    this.ensureContext();
    this.unmute();
    this.sampler?.triggerAttack(note, now(), velocity);
  }

  public stopTone(note: string) {
    if (!note || this._isSustainPedalDown || !this.sampler) return;
    this.sampler.triggerRelease(note, now());
  }

  public setPedal(isDown: boolean) {
    this._isSustainPedalDown = isDown;
    if (!isDown && this.sampler) this.sampler.releaseAll();
  }

  public scheduleEvents(events: { note: string; time: number; duration: number; velocity: number }[]) {
    this.cachedEvents = events;
    this.resetPlayback();
  }

  private rebuildAndSchedule() {
    if (!this.activeCallbacks) return;
    getTransport().stop();
    getTransport().cancel(0);
    const { onEnd, onClear } = this.activeCallbacks;
    onClear();
    const sampler = this.createSampler();
    this.unmute();
    getTransport().bpm.value = 120;
    let maxTime = 0;
    this.cachedEvents.forEach(event => {
        const startTime = event.time;
        const endTime = event.time + event.duration;
        if (endTime > maxTime) maxTime = endTime;
        getTransport().schedule((time) => {
            sampler.triggerAttackRelease(event.note, event.duration, time, event.velocity);
        }, startTime);
    });
    getTransport().schedule((time) => getDraw().schedule(() => onEnd(), time), maxTime + 0.5);
  }

  public async play(callbacks?: { onEnd: () => void; onClear: () => void; }) { 
    await this.ensureContext();
    if (callbacks) {
        this.activeCallbacks = callbacks;
        this.rebuildAndSchedule();
    }
    if (!this.sampler) this.createSampler();
    this.unmute();
    getTransport().start(); 
  }

  public pause() { 
    getTransport().pause(); 
    if (this.sampler) this.sampler.releaseAll();
  }
  
  public mute() {
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.rampTo(0, 0.01); 
    }
    if (this.reverb) {
        try { this.reverb.wet.rampTo(0, 0.01); } catch (e) {}
    }
    if (this.sampler) {
        this.sampler.volume.cancelScheduledValues(now());
        this.sampler.volume.value = -100; 
    }
  }

  public unmute() {
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.rampTo(0.8, 0.01); 
    }
    if (this.reverb) {
        try { this.reverb.wet.rampTo(0.35, 0.1); } catch (e) {}
    }
    if (this.sampler) {
        this.sampler.volume.cancelScheduledValues(now());
        this.sampler.volume.rampTo(-2, 0.01); 
    }
  }

  public resetPlayback() { 
    this.mute(); 
    getTransport().stop(); 
    getTransport().cancel(0); 
    if (this.sampler) {
        try { 
            // KILL ALL VOICES INSTANTLY
            const originalRelease = this.sampler.release;
            this.sampler.release = 0; 
            this.sampler.releaseAll();
            this.sampler.release = originalRelease;
            
            // LOCK VOLUME
            this.sampler.volume.cancelScheduledValues(now());
            this.sampler.volume.value = -100;
        } catch (e) {}
    }
    // Hard reset transport state
    getTransport().seconds = 0;
    this.activeCallbacks = null;
  }
  
  public stopSequence() { this.resetPlayback(); }
  public stopPlayback() { this.resetPlayback(); }
  public getCurrentTime(): number { return getTransport().seconds; }
}

export const audioService = new AudioService();