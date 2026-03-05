const TWO_PI = Math.PI * 2;

export type MusicLabTrack = 'menu' | 'race';
type WaveType = 'sine' | 'triangle' | 'sawtooth' | 'square';
type ScaleType = 'minor' | 'major' | 'dorian' | 'phrygian';

export interface MusicLabPreset {
  bpm: number;
  energy: number;
  brightness: number;
  bass: number;
  lead: number;
  swing: number;
  kickLevel: number;
  kickPitchStart: number;
  kickPitchEnd: number;
  kickDecay: number;
  bassLevel: number;
  leadLevel: number;
  hatLevel: number;
  leadAir: number;
  rootMidi: number;
  scale: ScaleType;
  bassWave: WaveType;
  leadWave: WaveType;
  bassPattern: number[];
  leadPattern: number[];
}

export const defaultMusicLabPreset = (track: MusicLabTrack): MusicLabPreset =>
  track === 'menu'
    ? {
      bpm: 118, energy: 0.55, brightness: 0.45, bass: 0.52, lead: 0, swing: 0.08,
      kickLevel: 0.12, kickPitchStart: 0.58, kickPitchEnd: 0.34, kickDecay: 0.46,
      bassLevel: 0.8, leadLevel: 0.47, hatLevel: 0.55, leadAir: 0.35,
      rootMidi: 50, scale: 'minor', bassWave: 'sawtooth', leadWave: 'triangle',
      bassPattern: [0, -1, 2, -1, 3, -1, 2, -1, 0, -1, 4, -1, 3, -1, 2, -1],
      leadPattern: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    }
    : {
      bpm: 125, energy: 0.44, brightness: 0.3, bass: 0.72, lead: 0.62, swing: 0.12,
      kickLevel: 0, kickPitchStart: 0.66, kickPitchEnd: 0.38, kickDecay: 0.52,
      bassLevel: 0.92, leadLevel: 0.8, hatLevel: 0.75, leadAir: 0.5,
      rootMidi: 50, scale: 'phrygian', bassWave: 'sawtooth', leadWave: 'triangle',
      bassPattern: [0, -1, 0, -1, 2, -1, 0, -1, 3, -1, 2, -1, 0, -1, 4, -1],
      leadPattern: [7, 9, 10, 9, 7, 5, 4, 5, 7, 9, 10, 12, 10, 9, 7, 5],
    };

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
const clampPattern = (value: unknown): number[] => {
  const arr = Array.isArray(value) ? value : [];
  const out = new Array(16).fill(-1);
  for (let i = 0; i < 16; i++) {
    const n = Number(arr[i]);
    if (!Number.isFinite(n)) continue;
    out[i] = Math.max(-1, Math.min(15, Math.round(n)));
  }
  return out;
};
const scales: Record<ScaleType, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17],
  major: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17],
  dorian: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17],
  phrygian: [0, 1, 3, 5, 7, 8, 10, 12, 13, 15, 17],
};

const tri = (phase: number): number => 4 * Math.abs(((phase + 0.25) % 1) - 0.5) - 1;
const saw = (phase: number): number => 2 * ((phase % 1) - 0.5);
const sine = (phase: number): number => Math.sin(TWO_PI * phase);
const osc = (phase: number, wave: WaveType): number => {
  if (wave === 'triangle') return tri(phase);
  if (wave === 'sawtooth') return saw(phase);
  if (wave === 'square') return phase % 1 < 0.5 ? 1 : -1;
  return sine(phase);
};

const adsr = (
  t: number,
  duration: number,
  attack = 0.01,
  decay = 0.05,
  sustain = 0.5,
  release = 0.1,
): number => {
  if (t < 0 || t > duration) return 0;
  if (t <= attack) return t / Math.max(0.0001, attack);
  const decayEnd = attack + decay;
  if (t <= decayEnd) {
    const dt = (t - attack) / Math.max(0.0001, decay);
    return lerp(1, sustain, dt);
  }
  const releaseStart = Math.max(0, duration - release);
  if (t < releaseStart) return sustain;
  const rt = (t - releaseStart) / Math.max(0.0001, release);
  return sustain * (1 - clamp(rt, 0, 1));
};

const noise = (seed: number): number => {
  const x = Math.sin(seed * 12345.678 + 45.678) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

export const normalizeMusicLabPreset = (value: Partial<MusicLabPreset>, track: MusicLabTrack): MusicLabPreset => {
  const base = defaultMusicLabPreset(track);
  return {
    bpm: clamp(value.bpm ?? base.bpm, 90, 170),
    energy: clamp01(value.energy ?? base.energy),
    brightness: clamp01(value.brightness ?? base.brightness),
    bass: clamp01(value.bass ?? base.bass),
    lead: clamp01(value.lead ?? base.lead),
    swing: clamp01(value.swing ?? base.swing),
    kickLevel: clamp01(value.kickLevel ?? base.kickLevel),
    kickPitchStart: clamp01(value.kickPitchStart ?? base.kickPitchStart),
    kickPitchEnd: clamp01(value.kickPitchEnd ?? base.kickPitchEnd),
    kickDecay: clamp01(value.kickDecay ?? base.kickDecay),
    bassLevel: clamp01(value.bassLevel ?? base.bassLevel),
    leadLevel: clamp01(value.leadLevel ?? base.leadLevel),
    hatLevel: clamp01(value.hatLevel ?? base.hatLevel),
    leadAir: clamp01(value.leadAir ?? base.leadAir),
    rootMidi: clamp(Math.round(value.rootMidi ?? base.rootMidi), 36, 72),
    scale: value.scale === 'major' || value.scale === 'dorian' || value.scale === 'phrygian' ? value.scale : base.scale,
    bassWave: value.bassWave === 'sine' || value.bassWave === 'triangle' || value.bassWave === 'square' ? value.bassWave : base.bassWave,
    leadWave: value.leadWave === 'sine' || value.leadWave === 'triangle' || value.leadWave === 'square' ? value.leadWave : base.leadWave,
    bassPattern: clampPattern(value.bassPattern ?? base.bassPattern),
    leadPattern: clampPattern(value.leadPattern ?? base.leadPattern),
  };
};

export const renderMusicLabLoop = (
  sampleRate: number,
  durationSec: number,
  track: MusicLabTrack,
  presetIn: MusicLabPreset,
): Float32Array => {
  const preset = normalizeMusicLabPreset(presetIn, track);
  const samples = new Float32Array(Math.floor(sampleRate * durationSec));
  const beatSec = 60 / preset.bpm;
  const sixteenthSec = beatSec / 4;
  const scale = scales[preset.scale];
  const getNoteFreq = (stepValue: number, octaveOffset = 0): number => {
    const idx = Math.max(0, Math.min(scale.length - 1, stepValue));
    const midi = preset.rootMidi + scale[idx] + octaveOffset * 12;
    return midiToFreq(midi);
  };

  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const beat = t % beatSec;
    const step = t % sixteenthSec;
    const stepIndex = Math.floor((t / sixteenthSec) % 16);

    const kickDecaySec = lerp(0.1, 0.32, preset.kickDecay);
    const kickEnv = adsr(beat, kickDecaySec, 0.001, 0.035, 0.0, Math.max(0.06, kickDecaySec * 0.65));
    const kickStart = lerp(70, 170, preset.kickPitchStart);
    const kickEnd = lerp(22, 85, preset.kickPitchEnd);
    const kickFreq = lerp(kickStart, kickEnd, clamp(beat / Math.max(0.001, kickDecaySec * 0.9), 0, 1));
    const kick = (0.24 + preset.energy * 0.14) * preset.kickLevel * kickEnv * sine(t * kickFreq);

    const sidechain = 1 - kickEnv * (0.25 + preset.energy * 0.4);
    const bassStep = preset.bassPattern[stepIndex] ?? -1;
    const bassFreq = bassStep >= 0 ? getNoteFreq(bassStep, -1) : 0;
    const bassGate = bassStep >= 0 ? adsr(step, sixteenthSec, 0.003, 0.03, 0.36, 0.05) : 0;
    const bass =
      (0.09 + preset.bass * 0.16)
      * preset.bassLevel
      * sidechain
      * bassGate
      * (0.74 * osc(t * bassFreq, preset.bassWave) + 0.26 * sine(t * bassFreq * 0.5));

    const leadStep = preset.leadPattern[stepIndex] ?? -1;
    const leadFreq = leadStep >= 0 ? getNoteFreq(leadStep, track === 'menu' ? 0 : 1) : 0;
    const leadEnv = leadStep >= 0 ? adsr(step, sixteenthSec, 0.003, 0.02, 0.2 + preset.lead * 0.45, 0.05) : 0;
    const lead = (0.05 + preset.lead * 0.13) * preset.leadLevel * sidechain * leadEnv * (
      (0.6 + preset.brightness * 0.4) * osc(t * leadFreq, preset.leadWave)
      + (0.25 + preset.brightness * 0.25) * preset.leadAir * sine(t * leadFreq * 2)
      + (0.15 + preset.brightness * 0.2) * tri(t * leadFreq * 0.5)
    );

    const hatTime = (t + preset.swing * sixteenthSec * 0.4) % sixteenthSec;
    const hatEnv = adsr(hatTime, 0.05, 0.001, 0.008, 0, 0.04);
    const hat = (0.015 + preset.brightness * 0.05) * preset.hatLevel * hatEnv * noise(t * 16000);

    const value = (kick + bass + lead + hat) * (0.74 + preset.energy * 0.16);
    samples[i] = Math.max(-1, Math.min(1, value));
  }

  return samples;
};
