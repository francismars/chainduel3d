import manifestJson from './audio-manifest.json';
import type { AudioCueDefinition, AudioManifest, AudioPreloadTier } from './types';

export class AudioAssetRegistry {
  private readonly cuesById = new Map<string, AudioCueDefinition>();

  constructor() {
    const manifest = manifestJson as AudioManifest;
    for (const cue of manifest.cues) {
      this.cuesById.set(cue.id, cue);
    }
  }

  getCue(id: string): AudioCueDefinition | null {
    return this.cuesById.get(id) ?? null;
  }

  getCuesByTier(tier: AudioPreloadTier): AudioCueDefinition[] {
    const out: AudioCueDefinition[] = [];
    for (const cue of this.cuesById.values()) {
      if ((cue.preloadTier ?? 'lazy') === tier) out.push(cue);
    }
    return out;
  }

  getAllCueIds(): string[] {
    return Array.from(this.cuesById.keys());
  }

  getAllCues(): AudioCueDefinition[] {
    return Array.from(this.cuesById.values());
  }
}
