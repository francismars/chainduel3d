import * as THREE from 'three';
import { Kart } from './Kart';
import { Track } from './Track';
import { PlayerInput } from './InputManager';

interface AIDriverContext {
  chainBlocks: number;
  rammingTarget?: THREE.Vector3;
}

export class AIDriver {
  private lastWaypointIdx = 0;
  private itemCooldown = 0;
  private steerNoise = 0;
  private noiseCooldown = 0;

  getInput(kart: Kart, track: Track, hasItem: boolean, dt: number, context?: AIDriverContext): PlayerInput {
    const pts = track.trackPoints;
    const n = pts.length;
    const kartPos = kart.getPosition();

    // Find nearest track point
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      const dx = kartPos.x - pts[i].position.x;
      const dz = kartPos.z - pts[i].position.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    this.lastWaypointIdx = bestIdx;

    // Look ahead 5-8 waypoints for steering target
    const lookAhead = Math.min(8, Math.max(5, Math.floor(kart.speed * 0.3)));
    const targetIdx = (bestIdx + lookAhead) % n;
    const target = pts[targetIdx].position;

    // Angle to target
    const dx = target.x - kartPos.x;
    const dz = target.z - kartPos.z;
    let targetAngle = Math.atan2(dx, dz);

    // If a weaker opponent is close, bias steering to ram
    if (context?.rammingTarget) {
      const tx = context.rammingTarget.x - kartPos.x;
      const tz = context.rammingTarget.z - kartPos.z;
      const ramAngle = Math.atan2(tx, tz);
      targetAngle = THREE.MathUtils.lerp(targetAngle, ramAngle, 0.6);
    }

    // Angle difference (how much we need to turn)
    let angleDiff = targetAngle - kart.heading;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    // Add slight noise so AI doesn't drive perfectly
    this.noiseCooldown -= dt;
    if (this.noiseCooldown <= 0) {
      this.steerNoise = (Math.random() - 0.5) * 0.15;
      this.noiseCooldown = 0.3 + Math.random() * 0.5;
    }
    angleDiff += this.steerNoise;

    // Steering
    const steerThreshold = 0.05;
    const left = angleDiff > steerThreshold;
    const right = angleDiff < -steerThreshold;

    // Drift on sharp corners, but be conservative when chain is short
    const chainBlocks = context?.chainBlocks ?? 5;
    const driftThreshold = chainBlocks <= 2 ? 0.75 : 0.5;
    const sharpCorner = Math.abs(angleDiff) > driftThreshold && kart.speed > 12;
    const drift = sharpCorner;

    // Brake if heading very wrong direction at high speed
    const veryWrong = Math.abs(angleDiff) > 1.2 && kart.speed > 15;
    const forward = !veryWrong;
    const backward = veryWrong;

    // Use items periodically
    this.itemCooldown -= dt;
    let useItem = false;
    if (hasItem && this.itemCooldown <= 0) {
      useItem = true;
      this.itemCooldown = 2 + Math.random() * 3;
    }

    return {
      forward,
      backward,
      left,
      right,
      drift,
      useItem,
      lookBack: false,
      sacrificeBoost: false,
    };
  }
}
