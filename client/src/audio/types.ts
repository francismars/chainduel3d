export type AudioCategory = 'music' | 'sfxGameplay' | 'sfxUi' | 'ambience';
export type AudioPreloadTier = 'critical' | 'standard' | 'lazy';
export type DynamicRangeMode = 'full' | 'medium' | 'low';

export interface AudioVariant {
  src: string;
  format?: 'webm' | 'ogg' | 'aac';
}

export interface SynthCue {
  waveform: OscillatorType;
  frequency: number;
  durationMs: number;
  attackMs?: number;
  releaseMs?: number;
}

export interface AudioCueDefinition {
  id: string;
  category: AudioCategory;
  variants?: AudioVariant[];
  synth?: SynthCue;
  frequencyJitterPct?: number;
  durationJitterMs?: number;
  gainJitterDb?: number;
  loop?: boolean;
  gainDb?: number;
  priority?: number;
  maxVoices?: number;
  cooldownMs?: number;
  preloadTier?: AudioPreloadTier;
}

export interface AudioManifest {
  version: number;
  cues: AudioCueDefinition[];
}

export interface AudioDiagnosticsSnapshot {
  unlocked: boolean;
  activeVoices: number;
  droppedByVoiceLimit: number;
  droppedByCueLimit: number;
  missingCueLookups: number;
  failedDecodes: number;
  decodedBufferCount: number;
}

export interface AudioSettingsState {
  masterVolume: number;
  musicVolume: number;
  sfxGameplayVolume: number;
  sfxUiVolume: number;
  ambienceVolume: number;
  masterMuted: boolean;
  reducedSensoryMode: boolean;
  dynamicRangeMode: DynamicRangeMode;
}
