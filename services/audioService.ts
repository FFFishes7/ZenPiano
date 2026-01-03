
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
          this.mute(); // ANTI-POP barrier
        }
      });
    }
  }

  private handlePassiveSuspend() {
    this.mute();
    getTransport().pause();
    if (this.sampler) {
        try { this.sampler.releaseAll(); } catch (e) {}
    }
    if (this.passivePauseHandler) this.passivePauseHandler();
  }

  public setPassivePauseHandler(handler: () => void) { this.passivePauseHandler = handler; }

  private _disposeResources() {
    if (this.sampler) { this.sampler.dispose(); this.sampler = null; }
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
      } catch (e) {}
      this.sampler = null;
    }
  }

  private createSampler(): Sampler {
    if (this.sampler) return this.sampler; 
    const bufferMap: Record<string, ToneAudioBuffer> = {};
    this.buffers.forEach((buffer, note) => { bufferMap[note] = buffer; });
    const sampler = new Sampler({ urls: bufferMap, release: 1, curve: "exponential", volume: -2 });
    if (this.output) sampler.connect(this.output);
    else sampler.toDestination();
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
    this._isAborting = false;
    this.isLoaded = false;
    this.output = new Gain(0.8);
    this.compressor = new Compressor({ threshold: -20, ratio: 3, attack: 0.05, release: 0.25 });
    this.reverb = new Reverb({ decay: 3.5, preDelay: 0.01, wet: 0.35 });
    this.output.chain(this.compressor, this.reverb, getDestination());
    await this.reverb.generate().catch(() => {});

    interface LoadTask { note: string; url: string; }
    const tasks: LoadTask[] = [];
    const baseUrl = "https://tonejs.github.io/audio/salamander/";
    SAMPLED_NOTES.forEach(note => {
        const safeNote = note.replace('#', 's');
        tasks.push({ note, url: `${baseUrl}${safeNote}.${FILE_EXT_LIGHT}` });
    });

    const totalFiles = tasks.length;
    let loadedCount = 0;
    for (let i = 0; i < totalFiles; i += 8) {
        if (this._isAborting) throw new Error("Loading cancelled");
        const batch = tasks.slice(i, i + 8);
        await Promise.all(batch.map(async (task) => {
            if (this._isAborting) return;
            try {
              const blob = await getCachedAudioBlob(task.url);
              const arrayBuffer = await blob.arrayBuffer();
              const audioBuffer = await getContext().decodeAudioData(arrayBuffer);
              this.buffers.set(task.note, new ToneAudioBuffer(audioBuffer));
            } catch (err) {}
            loadedCount++;
            onProgress((loadedCount / totalFiles) * 100);
        }));
    }
    this.createSampler();
    this.isLoaded = true;
    onProgress(100);
  }

  public async ensureContext() {
    if (getContext().state !== 'running') {
        try { await start(); } catch (e) {}
    }
  }

  public startTone(note: string, velocity: number = 0.7) {
    if (!this.isLoaded) return;
    if (!this.sampler) this.createSampler();
    this.ensureContext();
    this.unmute(); // FORCE restorative volume
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

  public scheduleEvents(events: { note: string; time: number; duration: number; velocity: number }[]) {
    this.cachedEvents = events;
    this.resetPlayback();
  }

  private rebuildAndSchedule() {
    if (!this.activeCallbacks) return;
    getTransport().stop();
    getTransport().cancel();
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
        this.output.gain.value = 0;
    }
    if (this.sampler) this.sampler.volume.value = -Infinity;
  }

  public unmute() {
    if (this.output) {
        this.output.gain.cancelScheduledValues(now());
        this.output.gain.value = 0.8;
    }
    if (this.sampler) this.sampler.volume.value = -2;
  }

  public resetPlayback() { 
    this.mute();
    getTransport().stop(); 
    getTransport().cancel(); 
    if (this.sampler) {
        try { this.sampler.releaseAll(); } catch (e) {}
    }
    this.activeCallbacks = null;
  }
  
  public stopSequence() { this.resetPlayback(); }
  public stopPlayback() { this.resetPlayback(); }
  public getCurrentTime(): number { return getTransport().seconds; }
}

export const audioService = new AudioService();
