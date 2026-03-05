import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const TWO_PI = Math.PI * 2;

const cues = [
  'music_menu_loop',
  'music_race_loop',
  'countdown_tick',
  'countdown_go',
  'item_pickup',
  'item_use',
  'impact_hit',
  'chain_steal_hit',
  'lap_pass',
  'final_lap_alert',
  'finish_stinger',
  'win_stinger',
  'loss_stinger',
  'ui_hover',
  'ui_click',
  'ui_back',
  'ui_confirm',
];

const sine = phase => Math.sin(TWO_PI * phase);
const tri = phase => 4 * Math.abs(((phase + 0.25) % 1) - 0.5) - 1;
const saw = phase => 2 * ((phase % 1) - 0.5);
const square = phase => (phase % 1 < 0.5 ? 1 : -1);

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothStep = t => t * t * (3 - 2 * t);

function adsr(t, duration, attack = 0.01, decay = 0.06, sustain = 0.6, release = 0.08) {
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
  return sustain * (1 - smoothStep(clamp(rt, 0, 1)));
}

function writeWavMono16(filePath, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = clamp(samples[i], -1, 1);
    const pcm = s < 0 ? s * 32768 : s * 32767;
    buffer.writeInt16LE(Math.round(pcm), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function render(durationSec, sampleAt) {
  const total = Math.floor(durationSec * SAMPLE_RATE);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    out[i] = clamp(sampleAt(t), -1, 1);
  }
  return out;
}

function tone(t, freq, wave = 'sine', phaseOffset = 0) {
  const phase = t * freq + phaseOffset;
  if (wave === 'triangle') return tri(phase);
  if (wave === 'sawtooth') return saw(phase);
  if (wave === 'square') return square(phase);
  return sine(phase);
}

function noise(seed) {
  const x = Math.sin(seed * 12345.678 + 45.678) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function makeCue(id) {
  switch (id) {
    case 'music_menu_loop': {
      const duration = 8.0;
      return render(duration, t => {
        const kickPhase = t % 0.5;
        const kickEnv = adsr(kickPhase, 0.22, 0.002, 0.06, 0.0, 0.15);
        const kick = 0.2 * kickEnv * tone(t, lerp(90, 42, clamp(kickPhase / 0.2, 0, 1)), 'sine');
        const sidechain = 1 - 0.45 * kickEnv;
        const pad =
          0.14 * tone(t, 138.59, 'triangle') +
          0.1 * tone(t, 207.65, 'sine') +
          0.07 * tone(t, 277.18, 'sine');
        const arpStep = Math.floor((t * 4) % 8);
        const arpFreq = [277.18, 329.63, 369.99, 415.3, 369.99, 329.63, 311.13, 246.94][arpStep];
        const arpEnv = adsr(t % 0.25, 0.25, 0.004, 0.05, 0.35, 0.13);
        const arp = 0.12 * arpEnv * tone(t, arpFreq, 'sawtooth');
        const hat = 0.04 * adsr(t % 0.125, 0.06, 0.001, 0.01, 0.0, 0.045) * noise(t * 12000);
        return (kick + (pad + arp) * sidechain + hat) * 0.78;
      });
    }
    case 'music_race_loop': {
      const duration = 8.0;
      return render(duration, t => {
        const beat = t % 0.5;
        const kickEnv = adsr(beat, 0.24, 0.001, 0.06, 0.0, 0.17);
        const kickFreq = lerp(102, 40, clamp(beat / 0.22, 0, 1));
        const kick = 0.32 * kickEnv * tone(t, kickFreq, 'sine');
        const sidechain = 1 - 0.5 * kickEnv;
        const bassStep = Math.floor((t * 2) % 4);
        const bassFreq = [98, 98, 123.47, 87.31][bassStep];
        const bass = 0.18 * sidechain * (0.7 * tone(t, bassFreq, 'sawtooth') + 0.3 * tone(t, bassFreq * 0.5, 'sine'));
        const leadStep = Math.floor((t * 8) % 16);
        const leadFreq = [392, 440, 493.88, 587.33, 493.88, 440, 392, 329.63, 392, 440, 523.25, 659.25, 523.25, 440, 392, 349.23][leadStep];
        const leadEnv = adsr(t % 0.125, 0.125, 0.002, 0.02, 0.35, 0.06);
        const lead = 0.1 * sidechain * leadEnv * (0.7 * tone(t, leadFreq, 'sawtooth') + 0.25 * tone(t, leadFreq * 2, 'sine'));
        const hat = 0.06 * adsr(t % 0.125, 0.08, 0.001, 0.008, 0.0, 0.055) * noise(t * 16000);
        return (kick + bass + lead + hat) * 0.83;
      });
    }
    case 'countdown_tick':
      return render(0.14, t => {
        const env = adsr(t, 0.14, 0.001, 0.018, 0.22, 0.07);
        return 0.32 * env * (0.75 * tone(t, 980, 'sine') + 0.25 * tone(t, 1960, 'sine'));
      });
    case 'countdown_go':
      return render(0.32, t => {
        const env = adsr(t, 0.32, 0.004, 0.06, 0.6, 0.17);
        const freq = lerp(460, 900, clamp(t / 0.2, 0, 1));
        return 0.34 * env * (0.7 * tone(t, freq, 'triangle') + 0.3 * tone(t, freq * 0.5, 'sine'));
      });
    case 'item_pickup':
      return render(0.19, t => {
        const env = adsr(t, 0.19, 0.002, 0.05, 0.45, 0.09);
        const btcMotif = t < 0.08 ? 493.88 : 587.33;
        const f = lerp(760, 1040, clamp(t / 0.14, 0, 1));
        return 0.28 * env * (0.6 * tone(t, f, 'triangle') + 0.4 * tone(t, btcMotif, 'sine'));
      });
    case 'item_use':
      return render(0.24, t => {
        const env = adsr(t, 0.24, 0.002, 0.05, 0.5, 0.11);
        const f = lerp(600, 320, clamp(t / 0.2, 0, 1));
        const engineZip = 0.14 * env * tone(t, f, 'sawtooth');
        const transient = 0.09 * adsr(t, 0.06, 0.001, 0.01, 0.0, 0.045) * noise(t * 9000);
        return engineZip + transient;
      });
    case 'impact_hit':
      return render(0.26, t => {
        const env = adsr(t, 0.26, 0.001, 0.03, 0.14, 0.2);
        const thump = 0.31 * env * tone(t, lerp(170, 65, clamp(t / 0.2, 0, 1)), 'sine');
        const crack = 0.12 * adsr(t, 0.09, 0.001, 0.01, 0.0, 0.07) * noise(t * 7000);
        return thump + crack;
      });
    case 'chain_steal_hit':
      return render(0.31, t => {
        const env = adsr(t, 0.31, 0.001, 0.04, 0.18, 0.22);
        const down = 0.24 * env * tone(t, lerp(320, 120, clamp(t / 0.25, 0, 1)), 'triangle');
        const btcTag = 0.09 * adsr(t, 0.16, 0.002, 0.03, 0.2, 0.08) * tone(t, 246.94, 'sine');
        const crack = 0.08 * adsr(t, 0.08, 0.001, 0.01, 0.0, 0.06) * noise(t * 7000);
        return down + btcTag + crack;
      });
    case 'lap_pass':
      return render(0.22, t => {
        const env = adsr(t, 0.22, 0.002, 0.04, 0.55, 0.11);
        return 0.34 * env * (tone(t, 620, 'triangle') + 0.4 * tone(t, 930, 'sine'));
      });
    case 'final_lap_alert':
      return render(0.58, t => {
        const local = t % 0.29;
        const env = adsr(local, 0.29, 0.002, 0.04, 0.45, 0.15);
        const f = local < 0.14 ? 523.25 : 659.25;
        return 0.26 * env * (0.65 * tone(t, f, 'triangle') + 0.35 * tone(t, f * 0.5, 'sine'));
      });
    case 'finish_stinger':
      return render(0.64, t => {
        const env = adsr(t, 0.64, 0.004, 0.08, 0.52, 0.2);
        const chord = tone(t, 720, 'triangle') + 0.7 * tone(t, 910, 'sine') + 0.45 * tone(t, 1080, 'sine');
        return 0.25 * env * chord;
      });
    case 'win_stinger':
      return render(0.82, t => {
        const env = adsr(t, 0.82, 0.004, 0.09, 0.56, 0.28);
        const step = Math.floor((t / 0.16) % 5);
        const f = [660, 784, 988, 1174, 1318][step] ?? 1318;
        return 0.28 * env * (tone(t, f, 'triangle') + 0.35 * tone(t, f * 1.5, 'sine'));
      });
    case 'loss_stinger':
      return render(0.88, t => {
        const env = adsr(t, 0.88, 0.004, 0.08, 0.42, 0.3);
        const f = lerp(320, 120, clamp(t / 0.8, 0, 1));
        return 0.28 * env * tone(t, f, 'sawtooth');
      });
    case 'ui_hover':
      return render(0.08, t => 0.12 * adsr(t, 0.08, 0.001, 0.015, 0.35, 0.03) * tone(t, 880, 'sine'));
    case 'ui_click':
      return render(0.11, t => {
        const env = adsr(t, 0.11, 0.001, 0.02, 0.3, 0.04);
        return 0.17 * env * (0.7 * tone(t, 720, 'triangle') + 0.3 * tone(t, 1440, 'sine'));
      });
    case 'ui_back':
      return render(0.12, t => {
        const env = adsr(t, 0.12, 0.001, 0.02, 0.35, 0.05);
        return 0.22 * env * tone(t, lerp(500, 360, clamp(t / 0.08, 0, 1)), 'triangle');
      });
    case 'ui_confirm':
      return render(0.13, t => {
        const env = adsr(t, 0.13, 0.001, 0.02, 0.45, 0.05);
        return 0.23 * env * tone(t, lerp(760, 940, clamp(t / 0.09, 0, 1)), 'triangle');
      });
    default:
      throw new Error(`Unhandled cue: ${id}`);
  }
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const outDir = path.join(root, 'client', 'public', 'audio');
  fs.mkdirSync(outDir, { recursive: true });

  for (const cue of cues) {
    const samples = makeCue(cue);
    const filePath = path.join(outDir, `${cue}.wav`);
    writeWavMono16(filePath, samples);
    const seconds = (samples.length / SAMPLE_RATE).toFixed(2);
    console.log(`generated ${cue}.wav (${seconds}s)`);
  }
}

main();
