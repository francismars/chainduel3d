import { AudioAssetRegistry } from './AudioAssetRegistry';
import { AudioMixer } from './AudioMixer';
import type { AudioCueDefinition, AudioDiagnosticsSnapshot, AudioSettingsState } from './types';

interface ActiveVoice {
  cueId: string;
  startedAtMs: number;
  stop?: () => void;
}

const MAX_ACTIVE_VOICES_DESKTOP = 24;
const MAX_ACTIVE_VOICES_MOBILE = 16;

const isProbablyMobile = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const pickPlayableVariant = (variants: NonNullable<AudioCueDefinition['variants']>): string | null => {
  const audio = document.createElement('audio');
  for (const v of variants) {
    if (!v.format) return v.src;
    const mime = v.format === 'webm' ? 'audio/webm; codecs=opus' : v.format === 'ogg' ? 'audio/ogg' : 'audio/mp4';
    if (audio.canPlayType(mime) !== '') return v.src;
  }
  return variants[0]?.src ?? null;
};

export class AudioEngine {
  readonly context: AudioContext;
  readonly mixer: AudioMixer;

  private readonly registry: AudioAssetRegistry;
  private readonly decodedBuffers = new Map<string, AudioBuffer>();
  private readonly customLoopBuffers = new Map<string, AudioBuffer>();
  private readonly htmlLoops = new Map<string, HTMLAudioElement>();
  private readonly loopSources = new Map<string, AudioBufferSourceNode>();
  private readonly lastPlayAt = new Map<string, number>();
  private readonly activeVoices: ActiveVoice[] = [];
  private readonly disabledCueIds = new Set<string>();

  private unlocked = false;
  private droppedByVoiceLimit = 0;
  private droppedByCueLimit = 0;
  private missingCueLookups = 0;
  private failedDecodes = 0;

  constructor(registry: AudioAssetRegistry) {
    this.registry = registry;
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.mixer = new AudioMixer(this.context);
  }

  isUnlocked(): boolean {
    return this.unlocked && this.context.state === 'running';
  }

  async unlock(): Promise<boolean> {
    try {
      await this.context.resume();
      // iOS/Safari unlock hardening: a near-silent click through graph.
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      gain.gain.value = 0.00001;
      osc.connect(gain);
      gain.connect(this.mixer.categoryBus.sfxUi);
      osc.start();
      osc.stop(this.context.currentTime + 0.01);
      this.unlocked = true;
      return true;
    } catch {
      return false;
    }
  }

  async suspend(): Promise<void> {
    if (this.context.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    await this.context.resume();
  }

  applySettings(settings: AudioSettingsState) {
    this.mixer.applySettings(settings);
  }

  async preloadCritical(): Promise<void> {
    const cues = [
      ...this.registry.getCuesByTier('critical'),
      ...this.registry.getCuesByTier('standard').slice(0, 4),
    ];
    for (const cue of cues) {
      await this.ensureDecoded(cue);
    }
  }

  async preloadTieredInBackground(): Promise<void> {
    const tiers: Array<'standard' | 'lazy'> = ['standard', 'lazy'];
    for (const tier of tiers) {
      const cues = this.registry.getCuesByTier(tier);
      for (const cue of cues) {
        await this.ensureDecoded(cue);
        // Yield to keep decode work from monopolizing a frame.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  async playCue(cueId: string): Promise<boolean> {
    if (this.disabledCueIds.has(cueId)) return false;
    const cue = this.registry.getCue(cueId);
    if (!cue) {
      this.missingCueLookups++;
      return false;
    }
    if (!this.isUnlocked()) return false;
    if (cue.cooldownMs && !this.passesCooldown(cueId, cue.cooldownMs)) return false;
    if (!this.passesCueVoiceLimit(cue)) return false;
    this.enforceVoiceBudget();

    const hasVariants = !!cue.variants?.length;
    if (hasVariants) {
      const buffer = await this.ensureDecoded(cue);
      if (buffer) {
        this.playBuffer(cue, buffer);
        return true;
      }
    }
    if (cue.synth) {
      this.playSynth(cue);
      return true;
    }
    return false;
  }

  async playLoop(cueId: string): Promise<boolean> {
    if (this.disabledCueIds.has(cueId)) return false;
    const cue = this.registry.getCue(cueId);
    if (!cue || !cue.loop || !this.isUnlocked()) return false;
    const customLoop = this.customLoopBuffers.get(cueId);
    if (customLoop) {
      if (this.loopSources.has(cueId)) return true;
      const source = this.context.createBufferSource();
      source.buffer = customLoop;
      source.loop = true;
      this.mixer.connectSource(cue.category, source, cue.gainDb ?? 0);
      source.start();
      this.loopSources.set(cueId, source);
      const voice: ActiveVoice = {
        cueId,
        startedAtMs: performance.now(),
        stop: () => {
          try {
            source.stop();
          } catch {
            // noop
          }
        },
      };
      this.activeVoices.push(voice);
      source.onended = () => {
        this.loopSources.delete(cueId);
        const idx = this.activeVoices.indexOf(voice);
        if (idx >= 0) this.activeVoices.splice(idx, 1);
      };
      return true;
    }
    const src = cue.variants ? pickPlayableVariant(cue.variants) : null;
    if (src) {
      const existing = this.htmlLoops.get(cueId);
      if (existing) {
        existing.play().catch(() => {});
        return true;
      }
      const audio = new Audio(src);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 1;
      const mediaNode = this.context.createMediaElementSource(audio);
      this.mixer.connectSource(cue.category, mediaNode, cue.gainDb ?? 0);
      this.htmlLoops.set(cueId, audio);
      try {
        await audio.play();
        this.activeVoices.push({ cueId, startedAtMs: performance.now(), stop: () => audio.pause() });
        return true;
      } catch {
        this.htmlLoops.delete(cueId);
      }
    }
    if (cue.synth) {
      this.playSynth(cue, true);
      return true;
    }
    return false;
  }

  stopCue(cueId: string) {
    for (const voice of [...this.activeVoices]) {
      if (voice.cueId === cueId) {
        voice.stop?.();
      }
    }
    const loop = this.htmlLoops.get(cueId);
    if (loop) {
      loop.pause();
      loop.currentTime = 0;
      this.htmlLoops.delete(cueId);
    }
    const sourceLoop = this.loopSources.get(cueId);
    if (sourceLoop) {
      try {
        sourceLoop.stop();
      } catch {
        // noop
      }
      this.loopSources.delete(cueId);
    }
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      if (this.activeVoices[i].cueId === cueId) this.activeVoices.splice(i, 1);
    }
  }

  stopAllLoops() {
    for (const cueId of this.htmlLoops.keys()) this.stopCue(cueId);
    for (const cueId of this.loopSources.keys()) this.stopCue(cueId);
  }

  setCustomLoopBuffer(cueId: string, samples: Float32Array, sampleRate: number) {
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    this.customLoopBuffers.set(cueId, buffer);
    this.stopCue(cueId);
  }

  setCueDisabled(cueId: string, disabled: boolean) {
    if (disabled) {
      this.disabledCueIds.add(cueId);
      this.stopCue(cueId);
      return;
    }
    this.disabledCueIds.delete(cueId);
  }

  isCueDisabled(cueId: string): boolean {
    return this.disabledCueIds.has(cueId);
  }

  getDiagnostics(): AudioDiagnosticsSnapshot {
    return {
      unlocked: this.isUnlocked(),
      activeVoices: this.activeVoices.length,
      droppedByVoiceLimit: this.droppedByVoiceLimit,
      droppedByCueLimit: this.droppedByCueLimit,
      missingCueLookups: this.missingCueLookups,
      failedDecodes: this.failedDecodes,
      decodedBufferCount: this.decodedBuffers.size,
    };
  }

  private passesCooldown(cueId: string, cooldownMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlayAt.get(cueId) ?? -Infinity;
    if (now - last < cooldownMs) return false;
    this.lastPlayAt.set(cueId, now);
    return true;
  }

  private enforceVoiceBudget() {
    const budget = isProbablyMobile() ? MAX_ACTIVE_VOICES_MOBILE : MAX_ACTIVE_VOICES_DESKTOP;
    while (this.activeVoices.length >= budget) {
      const oldest = this.activeVoices.shift();
      if (oldest?.stop) oldest.stop();
      this.droppedByVoiceLimit++;
    }
  }

  private passesCueVoiceLimit(cue: AudioCueDefinition): boolean {
    const limit = cue.maxVoices ?? (cue.category === 'sfxGameplay' ? 6 : cue.category === 'sfxUi' ? 4 : 2);
    if (limit <= 0) return true;
    let activeForCue = 0;
    for (const voice of this.activeVoices) {
      if (voice.cueId === cue.id) activeForCue++;
    }
    if (activeForCue < limit) return true;
    this.droppedByCueLimit++;
    return false;
  }

  private playBuffer(cue: AudioCueDefinition, buffer: AudioBuffer) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = !!cue.loop;
    if (!cue.loop && cue.frequencyJitterPct) {
      const pct = Math.max(0, cue.frequencyJitterPct);
      const offset = (Math.random() * 2 - 1) * pct;
      source.playbackRate.value = Math.max(0.75, Math.min(1.25, 1 + offset / 100));
    }
    this.mixer.connectSource(cue.category, source, cue.gainDb ?? 0);
    const voice: ActiveVoice = { cueId: cue.id, startedAtMs: performance.now() };
    this.activeVoices.push(voice);
    source.onended = () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx >= 0) this.activeVoices.splice(idx, 1);
    };
    source.start();
  }

  private playSynth(cue: AudioCueDefinition, forceLoop = false) {
    if (!cue.synth) return;
    const synth = cue.synth;
    const osc = this.context.createOscillator();
    const env = this.context.createGain();
    const start = this.context.currentTime;
    const attack = Math.max(0.001, (synth.attackMs ?? 5) / 1000);
    const release = Math.max(0.01, (synth.releaseMs ?? 80) / 1000);
    const durationJitter = cue.durationJitterMs ? (Math.random() * 2 - 1) * cue.durationJitterMs : 0;
    const duration = Math.max(0.03, (synth.durationMs + durationJitter) / 1000);
    const end = start + duration;

    osc.type = synth.waveform;
    const freqJitterPct = cue.frequencyJitterPct ?? 0;
    const freqMul = 1 + ((Math.random() * 2 - 1) * freqJitterPct) / 100;
    const frequency = Math.max(60, synth.frequency * freqMul);
    osc.frequency.value = frequency;
    if (cue.category === 'sfxGameplay') {
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.86), end);
    }
    const shouldLoop = cue.loop || forceLoop;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(1, start + attack);
    if (shouldLoop) {
      env.gain.setValueAtTime(0.8, start + attack);
    } else {
      env.gain.setValueAtTime(1, Math.max(start + attack, end - release));
      env.gain.linearRampToValueAtTime(0.0001, end);
    }

    const gainJitter = cue.gainJitterDb ? (Math.random() * 2 - 1) * cue.gainJitterDb : 0;
    const cueGain = this.mixer.connectSource(cue.category, env, (cue.gainDb ?? 0) + gainJitter);
    osc.connect(env);

    const voice: ActiveVoice = {
      cueId: cue.id,
      startedAtMs: performance.now(),
      stop: () => {
        try {
          const now = this.context.currentTime;
          env.gain.cancelScheduledValues(now);
          env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), now);
          env.gain.linearRampToValueAtTime(0.0001, now + 0.04);
          osc.stop(now + 0.05);
        } catch {
          // already stopped
        }
      },
    };
    this.activeVoices.push(voice);
    osc.onended = () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx >= 0) this.activeVoices.splice(idx, 1);
      cueGain.disconnect();
    };
    osc.start(start);
    if (shouldLoop) {
      // Keep oscillating until stopCue()/stopAllLoops() triggers voice.stop.
    } else {
      osc.stop(end + 0.01);
    }
  }

  private async ensureDecoded(cue: AudioCueDefinition): Promise<AudioBuffer | null> {
    if (!cue.variants?.length) return null;
    if (this.decodedBuffers.has(cue.id)) return this.decodedBuffers.get(cue.id)!;
    const src = pickPlayableVariant(cue.variants);
    if (!src) return null;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const decoded = await this.context.decodeAudioData(arrayBuffer);
      this.decodedBuffers.set(cue.id, decoded);
      return decoded;
    } catch {
      this.failedDecodes++;
      return null;
    }
  }
}
