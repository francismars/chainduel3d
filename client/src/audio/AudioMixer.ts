import type { AudioCategory, AudioSettingsState, DynamicRangeMode } from './types';

const dbToGain = (db: number): number => Math.pow(10, db / 20);

export class AudioMixer {
  readonly master: GainNode;
  readonly categoryBus: Record<AudioCategory, GainNode>;
  readonly compressor: DynamicsCompressorNode;

  private readonly context: AudioContext;

  constructor(context: AudioContext) {
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0.9;

    this.categoryBus = {
      music: context.createGain(),
      sfxGameplay: context.createGain(),
      sfxUi: context.createGain(),
      ambience: context.createGain(),
    };

    this.compressor = context.createDynamicsCompressor();
    this.applyDynamicRange('full');

    this.categoryBus.music.connect(this.master);
    this.categoryBus.sfxGameplay.connect(this.master);
    this.categoryBus.sfxUi.connect(this.master);
    this.categoryBus.ambience.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(context.destination);
  }

  connectSource(category: AudioCategory, source: AudioNode, gainDb = 0): GainNode {
    const cueGain = this.context.createGain();
    cueGain.gain.value = dbToGain(gainDb);
    source.connect(cueGain);
    cueGain.connect(this.categoryBus[category]);
    return cueGain;
  }

  applySettings(settings: AudioSettingsState) {
    this.master.gain.value = settings.masterMuted ? 0 : settings.masterVolume;
    this.categoryBus.music.gain.value = settings.musicVolume;
    this.categoryBus.sfxGameplay.gain.value = settings.sfxGameplayVolume;
    this.categoryBus.sfxUi.gain.value = settings.sfxUiVolume;
    this.categoryBus.ambience.gain.value = settings.ambienceVolume;
    this.applyDynamicRange(settings.dynamicRangeMode);
  }

  duckMusic(amountDb: number, releaseMs = 180) {
    const g = this.categoryBus.music.gain;
    const now = this.context.currentTime;
    const current = Math.max(0.0001, g.value);
    const ducked = Math.max(0, current * dbToGain(-Math.abs(amountDb)));
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    g.linearRampToValueAtTime(ducked, now + 0.02);
    g.linearRampToValueAtTime(current, now + Math.max(0.05, releaseMs / 1000));
  }

  private applyDynamicRange(mode: DynamicRangeMode) {
    if (mode === 'low') {
      this.compressor.threshold.value = -34;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 9;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;
      return;
    }
    if (mode === 'medium') {
      this.compressor.threshold.value = -28;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.22;
      return;
    }
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 15;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.25;
  }
}
