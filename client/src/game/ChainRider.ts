import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export interface ChainRiderConfig {
  color: number;
  startPosition: CANNON.Vec3;
  startRotation: number;
  chainClass?: ChainClass;
}

export type ChainClass = 'balanced' | 'light' | 'heavy';

export const DRIFT_LEVEL: Record<string, number> = {
  NONE: 0,
  BLUE: 1,
  ORANGE: 2,
  PURPLE: 3,
};

export class ChainRider {
  public body!: CANNON.Body;
  public mesh: THREE.Group;

  private readonly world: CANNON.World;
  private readonly color: number;
  private readonly startBlocks = 5;
  private readonly maxBlocks = 12;
  private readonly segmentSpacing = 0.88;

  // tuning
  private acceleration = 28;
  private readonly brakeStrength = 35;
  private maxSpeed = 28;
  public maxSpeedPublic = 28;
  private readonly reverseMax = 10;
  private turnRate = 2.6;
  private turnRateHigh = 1.4;
  private readonly coastDrag = 0.98;
  private readonly driftMinSpeed = 6;
  private readonly driftBaseTurn = 2.0;
  private readonly driftTighten = 3.2;
  private readonly driftWiden = 0.8;
  private readonly driftSlideAngle = 0.25;
  private readonly driftBoostBlue = 0.8;
  private readonly driftBoostOrange = 1.5;
  private readonly driftBoostPurple = 2.5;
  private readonly driftBoostSpeed = 6;

  // race state
  public heading = 0;
  public speed = 0;
  public currentSpeed = 0;
  public speedBoostActive = false;
  public slowActive = false;
  private speedBoostTimer = 0;
  private slowTimer = 0;
  public lap = 0;
  public lastCheckpoint = -1;
  public finished = false;
  public finishTime = 0;
  public airborne = false;
  public airborneTimer = 0;
  public airborneElapsed = 0;

  private hopTimer = 0;
  private hopDuration = 0.3;
  private hopHeight = 1.2;
  public hopOffset = 0;

  public drifting = false;
  public driftDirection = 0;
  public driftCharge = 0;
  public driftLevel = DRIFT_LEVEL.NONE;
  private driftVisualAngle = 0;

  private eliminated = false;
  private chainLength = 0;

  private segmentBodies: CANNON.Body[] = [];
  private segmentMeshes: THREE.Mesh[] = [];
  private linkConstraints: CANNON.DistanceConstraint[] = [];
  private segmentRenderY: number[] = [];
  private segmentFloorY: number[] = [];

  private sparkGroup: THREE.Group;
  private boostExhaust!: THREE.Mesh;
  private tunnelContactGlow!: THREE.Mesh;
  public readonly chainClass: ChainClass;
  private raceBalanceAssist = 1;
  private authoritativeControlEnabled = true;
  private tunnelRoll = 0;
  private readonly segmentTargetQuat = new THREE.Quaternion();
  private readonly segmentCurrentQuat = new THREE.Quaternion();
  private readonly segmentEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly groundSamplePos = new THREE.Vector3();

  constructor(world: CANNON.World, config: ChainRiderConfig) {
    this.world = world;
    this.color = config.color;
    this.chainClass = config.chainClass ?? 'balanced';
    this.applyChainClassTuning(this.chainClass);
    this.mesh = new THREE.Group();
    this.sparkGroup = new THREE.Group();
    this.mesh.add(this.sparkGroup);

    this.heading = config.startRotation;
    this.createHead(config.startPosition);
    this.buildSparkParticles();
    this.setChainLength(this.startBlocks);
    this.placeSegmentsAtStart(config.startPosition, config.startRotation);
    this.buildBoostExhaust();
    this.buildTunnelContactGlow();
  }

  private applyChainClassTuning(chainClass: ChainClass) {
    if (chainClass === 'light') {
      this.acceleration = 30;
      this.maxSpeed = 29;
      this.maxSpeedPublic = 29;
      this.turnRate = 2.75;
      this.turnRateHigh = 1.52;
      return;
    }
    if (chainClass === 'heavy') {
      this.acceleration = 26;
      this.maxSpeed = 27;
      this.maxSpeedPublic = 27;
      this.turnRate = 2.45;
      this.turnRateHigh = 1.32;
      return;
    }
    // balanced
    this.acceleration = 28;
    this.maxSpeed = 28;
    this.maxSpeedPublic = 28;
    this.turnRate = 2.6;
    this.turnRateHigh = 1.4;
  }

  setRaceBalanceAssist(mult: number) {
    this.raceBalanceAssist = THREE.MathUtils.clamp(mult, 0.9, 1.12);
  }

  setAuthoritativeControlEnabled(enabled: boolean) {
    this.authoritativeControlEnabled = enabled;
    this.applyAuthoritativeAxisLocks();
  }

  private applyAuthoritativeAxisLocks() {
    const yFactor = this.authoritativeControlEnabled ? 0 : 1;
    for (const b of this.segmentBodies) {
      b.linearFactor.set(1, yFactor, 1);
    }
  }

  private createHead(startPosition: CANNON.Vec3) {
    const shape = new CANNON.Box(new CANNON.Vec3(0.38, 0.38, 0.38));
    this.body = new CANNON.Body({
      mass: 5,
      shape,
      material: new CANNON.Material({ friction: 0, restitution: 0.05 }),
      linearDamping: 0.05,
      angularDamping: 0.9,
      fixedRotation: true,
      allowSleep: false,
      collisionFilterGroup: 1,
      collisionFilterMask: 0,
    });
    this.body.position.copy(startPosition);
    this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), this.heading);
    this.body.linearFactor.set(1, this.authoritativeControlEnabled ? 0 : 1, 1);
    this.world.addBody(this.body);
    this.segmentBodies.push(this.body);

    const headMesh = this.makeSegmentMesh(0);
    this.segmentMeshes.push(headMesh);
    this.segmentRenderY.push(startPosition.y);
    this.segmentFloorY.push(startPosition.y);
    this.mesh.add(headMesh);
  }

  private makeSegmentMesh(index: number): THREE.Mesh {
    const t = Math.min(index / Math.max(this.maxBlocks - 1, 1), 1);
    const size = THREE.MathUtils.lerp(0.82, 0.5, t);
    const c = new THREE.Color(this.color).multiplyScalar(THREE.MathUtils.lerp(1.0, 0.45, t));
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: 0.08,
      roughness: 0.55,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
    mesh.castShadow = true;
    return mesh;
  }

  private makeSegmentBody(index: number): CANNON.Body {
    const t = Math.min(index / Math.max(this.maxBlocks - 1, 1), 1);
    const half = THREE.MathUtils.lerp(0.41, 0.25, t);
    const mass = THREE.MathUtils.lerp(1.8, 1.0, t);
    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Box(new CANNON.Vec3(half, half, half)),
      material: new CANNON.Material({ friction: 0, restitution: 0.02 }),
      linearDamping: 0.22,
      angularDamping: 0.85,
      allowSleep: false,
      collisionFilterGroup: 1,
      collisionFilterMask: 0,
    });
    body.linearFactor.set(1, this.authoritativeControlEnabled ? 0 : 1, 1);
    return body;
  }

  private rebuildConstraints() {
    for (const c of this.linkConstraints) this.world.removeConstraint(c);
    this.linkConstraints = [];

    for (let i = 1; i < this.chainLength; i++) {
      const c = new CANNON.DistanceConstraint(
        this.segmentBodies[i - 1],
        this.segmentBodies[i],
        this.segmentSpacing,
        1e6,
      );
      this.world.addConstraint(c);
      this.linkConstraints.push(c);
    }
  }

  setChainLength(next: number) {
    if (next <= 0) {
      this.chainLength = 0;
      this.eliminated = true;
      this.speed = 0;
      this.currentSpeed = 0;
      this.deactivateAllSegments();
      return;
    }

    const clamped = Math.max(1, Math.min(this.maxBlocks, next));
    this.eliminated = false;
    this.activateAllSegments();

    while (this.segmentBodies.length < clamped) {
      const idx = this.segmentBodies.length;
      const b = this.makeSegmentBody(idx);
      this.world.addBody(b);
      this.segmentBodies.push(b);

      const m = this.makeSegmentMesh(idx);
      this.segmentMeshes.push(m);
      this.segmentRenderY.push(this.body.position.y);
      this.segmentFloorY.push(this.body.position.y);
      this.mesh.add(m);
    }

    while (this.segmentBodies.length > clamped) {
      const body = this.segmentBodies.pop()!;
      this.world.removeBody(body);
      const mesh = this.segmentMeshes.pop()!;
      this.mesh.remove(mesh);
      this.segmentRenderY.pop();
      this.segmentFloorY.pop();
    }

    this.chainLength = clamped;
    this.rebuildConstraints();
  }

  private deactivateAllSegments() {
    for (let i = 0; i < this.segmentBodies.length; i++) {
      const b = this.segmentBodies[i];
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.position.set(0, -200 - i * 2, 0);
      b.sleep();
    }
    for (const m of this.segmentMeshes) m.visible = false;
    this.sparkGroup.visible = false;
    if (this.boostExhaust) this.boostExhaust.visible = false;
  }

  private activateAllSegments() {
    for (const b of this.segmentBodies) {
      b.wakeUp();
    }
    for (const m of this.segmentMeshes) m.visible = true;
    if (this.boostExhaust) this.boostExhaust.visible = true;
  }

  private placeSegmentsAtStart(position: CANNON.Vec3, rotation: number) {
    const fx = Math.sin(rotation);
    const fz = Math.cos(rotation);
    for (let i = 0; i < this.chainLength; i++) {
      const b = this.segmentBodies[i];
      b.position.set(
        position.x - fx * i * this.segmentSpacing,
        position.y,
        position.z - fz * i * this.segmentSpacing,
      );
      b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotation);
      b.velocity.setZero();
      b.angularVelocity.setZero();
    }
  }

  getChainLength(): number {
    return this.chainLength;
  }

  applyNetworkState(
    x: number,
    y: number,
    z: number,
    heading: number,
    speed: number,
    chainLength: number,
    dt: number,
    drifting = false,
    driftDirection = 0,
    driftCharge = 0,
    eliminated = false,
    forceSnap = false,
  ) {
    const wasDrifting = this.drifting;
    const prevHeading = this.heading;
    const prevX = this.body.position.x;
    const prevY = this.body.position.y;
    const prevZ = this.body.position.z;
    const targetChain = eliminated
      ? 0
      : Math.max(1, Math.min(this.maxBlocks, Math.round(chainLength)));
    if (targetChain !== this.chainLength) {
      this.setChainLength(targetChain);
    }
    if (targetChain <= 0) return;
    this.speed = speed;
    this.currentSpeed = speed;
    this.drifting = drifting;
    this.driftDirection = drifting ? (driftDirection >= 0 ? 1 : -1) : 0;
    this.driftCharge = Math.max(0, driftCharge);
    if (!wasDrifting && this.drifting) {
      this.hopTimer = this.hopDuration;
    }
    this.updateDriftLevel();
    const targetSlide = this.drifting ? this.driftDirection * 0.55 : 0;
    const blend = Math.min(1, Math.max(0, dt * 10));
    this.driftVisualAngle += (targetSlide - this.driftVisualAngle) * blend;

    const headingDelta = Math.atan2(Math.sin(heading - prevHeading), Math.cos(heading - prevHeading));
    this.heading = forceSnap
      ? heading
      : (prevHeading + headingDelta * Math.min(1, Math.max(0, dt * 14)));
    const posBlendXZ = forceSnap ? 1 : Math.min(1, Math.max(0.18, dt * 18));
    const posBlendY = forceSnap ? 1 : Math.min(1, Math.max(0.32, dt * 22));
    this.body.position.x = prevX + (x - prevX) * posBlendXZ;
    this.body.position.y = prevY + (y - prevY) * posBlendY;
    this.body.position.z = prevZ + (z - prevZ) * posBlendXZ;
    this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), this.heading);
    const moveAngle = this.drifting ? this.heading - this.driftDirection * this.driftSlideAngle : this.heading;
    this.body.velocity.x = Math.sin(moveAngle) * speed;
    this.body.velocity.z = Math.cos(moveAngle) * speed;
    this.body.velocity.y = (this.body.position.y - prevY) / Math.max(dt, 1 / 120);
    this.body.angularVelocity.setZero();
    this.updateChainFollow(Math.max(dt, 1 / 120));
  }

  triggerHopVisual() {
    this.hopTimer = this.hopDuration;
  }

  isEliminated(): boolean {
    return this.eliminated;
  }

  loseBlock(): boolean {
    if (!this.authoritativeControlEnabled) return false;
    if (this.chainLength <= 0) return false;
    this.setChainLength(this.chainLength - 1);
    return true;
  }

  gainBlock(): boolean {
    if (!this.authoritativeControlEnabled) return false;
    if (this.eliminated || this.chainLength <= 0) return false;
    const before = this.chainLength;
    this.setChainLength(this.chainLength + 1);
    return this.chainLength > before;
  }

  applyStealPenalty() {
    if (!this.authoritativeControlEnabled) return;
    if (this.eliminated || this.chainLength <= 0) return;
    const backwardX = -Math.sin(this.heading);
    const backwardZ = -Math.cos(this.heading);
    const knockback = 6.5;

    // Penalize the attacker's momentum so initiating bad contact has clear cost.
    this.speed = Math.min(this.speed * 0.35, 3.5);
    this.currentSpeed = this.speed;
    this.body.velocity.x = backwardX * knockback;
    this.body.velocity.z = backwardZ * knockback;
    this.body.angularVelocity.setZero();
    this.activateSlow(700);
  }

  applyStealReward() {
    if (!this.authoritativeControlEnabled) return;
    if (this.eliminated || this.chainLength <= 0) return;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);

    // Keep the hit chain stable and slightly advantaged after receiving a block.
    this.speed = Math.min(this.maxSpeed * 1.35, this.speed + 2.2);
    this.currentSpeed = this.speed;
    const forwardSpeed = Math.max(this.speed, 6);
    this.body.velocity.x = fx * forwardSpeed;
    this.body.velocity.z = fz * forwardSpeed;
  }

  applyInput(forward: boolean, backward: boolean, left: boolean, right: boolean, drift: boolean, dt: number) {
    if (!this.authoritativeControlEnabled) return;
    if (this.eliminated || this.chainLength <= 0) {
      this.speed = 0;
      this.currentSpeed = 0;
      return;
    }

    let speedMult = 1;
    if (this.speedBoostActive) speedMult = 1.8;
    if (this.slowActive) speedMult = 0.4;
    const chainPenalty = Math.max(0.65, 1 - (this.chainLength - this.startBlocks) * 0.03);

    const effMax = this.maxSpeed * speedMult * chainPenalty * this.raceBalanceAssist;
    const effAccel = this.acceleration * speedMult * (0.7 + this.raceBalanceAssist * 0.3);
    const effRev = this.reverseMax * speedMult;

    if (forward) {
      this.speed += effAccel * dt;
      if (this.speed > effMax) this.speed = effMax;
    } else if (backward) {
      if (this.speed > 0.5) {
        this.speed -= this.brakeStrength * dt;
        if (this.speed < 0) this.speed = 0;
      } else {
        this.speed -= effAccel * 0.5 * dt;
        if (this.speed < -effRev) this.speed = -effRev;
      }
    } else {
      this.speed *= this.coastDrag;
      if (Math.abs(this.speed) < 0.1) this.speed = 0;
    }

    const turning = left || right;
    const canDrift = drift && turning && this.speed >= this.driftMinSpeed;
    if (canDrift && !this.drifting) {
      this.drifting = true;
      this.driftDirection = left ? 1 : -1;
      this.driftCharge = 0;
      this.driftLevel = DRIFT_LEVEL.NONE;
      this.driftVisualAngle = 0;
      this.hopTimer = this.hopDuration;
    }

    if (this.drifting) {
      if (!drift || this.speed < this.driftMinSpeed * 0.3) {
        this.endDrift();
      } else {
        this.driftCharge += dt;
        this.updateDriftLevel();
        let turn = this.driftBaseTurn;
        const into = (this.driftDirection > 0 && left) || (this.driftDirection < 0 && right);
        const away = (this.driftDirection > 0 && right) || (this.driftDirection < 0 && left);
        if (into) turn = this.driftTighten;
        else if (away) turn = this.driftWiden;
        this.heading += this.driftDirection * turn * dt;
        const targetSlide = this.driftDirection * 0.55;
        this.driftVisualAngle += (targetSlide - this.driftVisualAngle) * 8 * dt;
      }
    } else {
      const abs = Math.abs(this.speed);
      if (abs > 0.3) {
        const t = Math.min(abs / this.maxSpeed, 1);
        const turn = THREE.MathUtils.lerp(this.turnRate, this.turnRateHigh, t);
        const sign = this.speed >= 0 ? 1 : -1;
        if (left) this.heading += turn * sign * dt;
        if (right) this.heading -= turn * sign * dt;
      }
      this.driftVisualAngle *= 0.85;
    }

    this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), this.heading);
    let moveAngle = this.heading;
    if (this.drifting) moveAngle = this.heading - this.driftDirection * this.driftSlideAngle;
    const fx = Math.sin(moveAngle);
    const fz = Math.cos(moveAngle);
    this.body.velocity.x = fx * this.speed;
    this.body.velocity.z = fz * this.speed;

    this.updateChainFollow(dt);

    if (this.airborne) this.airborneElapsed += dt;
    this.currentSpeed = this.speed;
  }

  private updateDriftLevel() {
    if (this.driftCharge >= 2.0) this.driftLevel = DRIFT_LEVEL.PURPLE;
    else if (this.driftCharge >= 1.2) this.driftLevel = DRIFT_LEVEL.ORANGE;
    else if (this.driftCharge >= 0.5) this.driftLevel = DRIFT_LEVEL.BLUE;
    else this.driftLevel = DRIFT_LEVEL.NONE;
  }

  private updateChainFollow(dt: number) {
    if (this.chainLength <= 1) return;

    // Do follow solve in small fixed substeps so behavior is stable at
    // varying frame times and high-speed drift transitions.
    const clampedDt = Math.min(dt, 0.05);
    const subSteps = Math.max(1, Math.min(4, Math.ceil(clampedDt / (1 / 120))));
    const stepDt = clampedDt / subSteps;

    const velGain = 24;
    const maxFollowSpeedBase = 30;

    for (let s = 0; s < subSteps; s++) {
      for (let i = 1; i < this.chainLength; i++) {
        const prev = this.segmentBodies[i - 1];
        const cur = this.segmentBodies[i];
        const linkT = this.chainLength <= 2 ? 0 : (i - 1) / (this.chainLength - 2);
        // Stiffness profile: keep front links tighter; tail slightly softer.
        const stiffness = THREE.MathUtils.lerp(1.2, 0.92, linkT);

        const toPrevX = prev.position.x - cur.position.x;
        const toPrevY = prev.position.y - cur.position.y;
        const toPrevZ = prev.position.z - cur.position.z;
        const dist = Math.sqrt(toPrevX * toPrevX + toPrevZ * toPrevZ) || 0.0001;
        const nx = toPrevX / dist;
        const nz = toPrevZ / dist;

        const desiredX = prev.position.x - nx * this.segmentSpacing;
        const desiredZ = prev.position.z - nz * this.segmentSpacing;
        const errX = desiredX - cur.position.x;
        const errZ = desiredZ - cur.position.z;

        // Project toward ideal spacing before velocity solve so links read
        // as connected blocks, not loose followers.
        const stretch = dist - this.segmentSpacing;
        if (Math.abs(stretch) > 0.001) {
          const corr = THREE.MathUtils.clamp(stretch * (0.55 * stiffness), -0.2, 0.2);
          cur.position.x += nx * corr;
          cur.position.z += nz * corr;
        }

        // Small positional nudge prevents lagging clusters without snapping.
        const nudgeFactor = Math.min(0.36, 1.0 * stepDt * stiffness);
        cur.position.x += THREE.MathUtils.clamp(errX * nudgeFactor, -0.14, 0.14);
        cur.position.z += THREE.MathUtils.clamp(errZ * nudgeFactor, -0.14, 0.14);

        let vx = cur.velocity.x * 0.9 + errX * velGain * stiffness * stepDt;
        let vz = cur.velocity.z * 0.9 + errZ * velGain * stiffness * stepDt;

        const maxFollowSpeed = maxFollowSpeedBase + i * 1.5;
        const speed = Math.sqrt(vx * vx + vz * vz);
        if (speed > maxFollowSpeed) {
          const ss = maxFollowSpeed / speed;
          vx *= ss;
          vz *= ss;
        }

        cur.velocity.x = vx;
        cur.velocity.z = vz;

        // Hard spacing bounds to prevent visible chain breakup under stress.
        const dxNow = prev.position.x - cur.position.x;
        const dzNow = prev.position.z - cur.position.z;
        const dNow = Math.sqrt(dxNow * dxNow + dzNow * dzNow) || 0.0001;
        const minD = this.segmentSpacing * 0.82;
        const maxD = this.segmentSpacing * 1.18;
        if (dNow < minD || dNow > maxD) {
          const targetD = THREE.MathUtils.clamp(dNow, minD, maxD);
          const scale = targetD / dNow;
          cur.position.x = prev.position.x - dxNow * scale;
          cur.position.z = prev.position.z - dzNow * scale;
        }

        if (!this.airborne) {
          const yErr = prev.position.y - cur.position.y;
          const yLerp = Math.abs(yErr) > 0.6 ? 0.78 : 0.56;
          cur.position.y += THREE.MathUtils.clamp(yErr * yLerp, -0.45, 0.45);
          // Prevent gravity-induced tail droop in authoritative (non-airborne) driving.
          cur.velocity.y = 0;
        }

        // Use yaw + limited pitch (smoothed) to avoid jagged "stair-step" segment posing.
        const horiz = Math.sqrt(toPrevX * toPrevX + toPrevZ * toPrevZ);
        if (horiz > 0.0001) {
          const yaw = Math.atan2(toPrevX, toPrevZ);
          const pitch = Math.atan2(toPrevY, horiz);
          const clampedPitch = THREE.MathUtils.clamp(pitch, -0.42, 0.42);
          this.segmentEuler.set(-clampedPitch, yaw, 0, 'YXZ');
          this.segmentTargetQuat.setFromEuler(this.segmentEuler);
          this.segmentCurrentQuat.set(
            cur.quaternion.x,
            cur.quaternion.y,
            cur.quaternion.z,
            cur.quaternion.w,
          );
          const rotBlend = Math.min(1, Math.max(0.18, stepDt * 16));
          this.segmentCurrentQuat.slerp(this.segmentTargetQuat, rotBlend);
          cur.quaternion.set(
            this.segmentCurrentQuat.x,
            this.segmentCurrentQuat.y,
            this.segmentCurrentQuat.z,
            this.segmentCurrentQuat.w,
          );
        }
      }
    }
  }

  stabilizeIdleChain(dt: number) {
    if (this.eliminated || this.chainLength <= 0) return;

    // During countdown/no-input windows keep the tip from drifting
    // so the rest of the chain does not dangle.
    this.body.velocity.x *= 0.8;
    this.body.velocity.z *= 0.8;
    this.body.angularVelocity.setZero();
    this.speed *= 0.9;
    if (Math.abs(this.speed) < 0.05) this.speed = 0;
    this.currentSpeed = this.speed;

    this.updateChainFollow(dt);
  }

  enforceSegmentGroundClearance(
    sampleElevation: (worldPos: THREE.Vector3) => number,
    dt: number,
    clearance = 0.52,
  ) {
    if (this.airborne || this.eliminated || this.chainLength <= 1) return;
    for (let i = 1; i < this.chainLength; i++) {
      const b = this.segmentBodies[i];
      this.groundSamplePos.set(b.position.x, b.position.y, b.position.z);
      const minY = sampleElevation(this.groundSamplePos) + clearance;
      const penetration = minY - b.position.y;
      // Soft correction with a tiny deadzone avoids visible micro-jitter
      // from fighting the chain follow solver on steep transitions.
      if (penetration > 0.015) {
        const desiredLift = penetration > 0.08 ? penetration : penetration * 0.45;
        const maxLiftThisFrame = 1.6 * dt + 0.004;
        b.position.y += Math.min(desiredLift, maxLiftThisFrame);
        if (b.velocity.y < 0) {
          b.velocity.y = Math.max(0, b.velocity.y * 0.35);
        }
      }
    }
  }

  private endDrift() {
    if (this.driftLevel >= DRIFT_LEVEL.BLUE) {
      let boostDuration = this.driftBoostBlue;
      let boostAmount = this.driftBoostSpeed * 0.7;
      if (this.driftLevel === DRIFT_LEVEL.ORANGE) {
        boostDuration = this.driftBoostOrange;
        boostAmount = this.driftBoostSpeed * 1.2;
      } else if (this.driftLevel === DRIFT_LEVEL.PURPLE) {
        boostDuration = this.driftBoostPurple;
        boostAmount = this.driftBoostSpeed * 1.8;
      }
      this.speed = Math.min(this.speed + boostAmount, this.maxSpeed * 1.6);
      this.activateSpeedBoost(boostDuration * 1000);
    }
    this.drifting = false;
    this.driftCharge = 0;
    this.driftLevel = DRIFT_LEVEL.NONE;
    this.driftVisualAngle = 0;
  }

  updateEffects(dt: number) {
    if (this.speedBoostActive) {
      this.speedBoostTimer -= dt * 1000;
      if (this.speedBoostTimer <= 0) this.speedBoostActive = false;
    }
    if (this.slowActive) {
      this.slowTimer -= dt * 1000;
      if (this.slowTimer <= 0) this.slowActive = false;
    }
    if (this.hopTimer > 0) {
      this.hopTimer -= dt;
      if (this.hopTimer < 0) this.hopTimer = 0;
    }
  }

  setTunnelRoll(targetRoll: number, dt: number) {
    const blend = Math.min(1, Math.max(0, dt * 6));
    // Leaving tunnel: decay directly to neutral to avoid visible wrap spin.
    if (Math.abs(targetRoll) < 0.001) {
      const exitBlend = Math.min(1, Math.max(0, dt * 4.5));
      this.tunnelRoll += (0 - this.tunnelRoll) * exitBlend;
      if (Math.abs(this.tunnelRoll) < 0.002) this.tunnelRoll = 0;
      return;
    }
    const tau = Math.PI * 2;
    const normalized = ((targetRoll % tau) + tau) % tau;
    const currentNorm = ((this.tunnelRoll % tau) + tau) % tau;
    const delta = Math.atan2(Math.sin(normalized - currentNorm), Math.cos(normalized - currentNorm));
    this.tunnelRoll += delta * blend;
    // Keep bounded so camera doesn't clamp against huge historical revolutions.
    this.tunnelRoll = Math.atan2(Math.sin(this.tunnelRoll), Math.cos(this.tunnelRoll));
  }

  getTunnelRoll(): number {
    return this.tunnelRoll;
  }

  activateSpeedBoost(duration: number) {
    this.speedBoostActive = true;
    this.speedBoostTimer = duration;
  }

  activateSlow(duration: number) {
    this.slowActive = true;
    this.slowTimer = duration;
  }

  syncMeshToPhysics(sampleElevation?: (worldPos: THREE.Vector3) => number) {
    if (this.eliminated || this.chainLength <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    if (this.hopTimer > 0) {
      const t = 1 - this.hopTimer / this.hopDuration;
      this.hopOffset = Math.sin(t * Math.PI) * this.hopHeight;
    } else {
      this.hopOffset = 0;
    }

    for (let i = 0; i < this.chainLength; i++) {
      const b = this.segmentBodies[i];
      const m = this.segmentMeshes[i];
      let renderY = b.position.y + this.hopOffset;
      if (sampleElevation) {
        this.groundSamplePos.set(b.position.x, b.position.y, b.position.z);
        const minRenderY = sampleElevation(this.groundSamplePos) + 0.52 + this.hopOffset;
        const prevFloorY = this.segmentFloorY[i];
        const floorY = Number.isFinite(prevFloorY)
          ? (
              minRenderY > prevFloorY
                ? prevFloorY + (minRenderY - prevFloorY) * 0.58 // rise quickly to avoid clipping
                : prevFloorY + (minRenderY - prevFloorY) * 0.12 // fall slowly to avoid chatter
            )
          : minRenderY;
        this.segmentFloorY[i] = floorY;
        if (renderY < floorY) renderY = floorY;
      }
      const prevRenderY = this.segmentRenderY[i];
      const smoothY = Number.isFinite(prevRenderY)
        ? prevRenderY + (renderY - prevRenderY) * 0.32
        : renderY;
      this.segmentRenderY[i] = smoothY;
      m.position.set(b.position.x, smoothY, b.position.z);
      m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      if (Math.abs(this.tunnelRoll) > 0.0001) {
        const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.tunnelRoll);
        m.quaternion.multiply(qRoll);
      }
    }

    const tail = this.segmentBodies[this.chainLength - 1];
    this.boostExhaust.position.set(tail.position.x, tail.position.y, tail.position.z - 0.9);
    this.boostExhaust.quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.heading + this.driftVisualAngle,
    );
    if (Math.abs(this.tunnelRoll) > 0.0001) {
      this.boostExhaust.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.tunnelRoll),
      );
    }

    this.updateSparks();
  }

  private buildBoostExhaust() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
    });
    this.boostExhaust = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.0, 8), mat);
    this.boostExhaust.rotation.x = Math.PI / 2;
    this.mesh.add(this.boostExhaust);
  }

  private buildTunnelContactGlow() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.tunnelContactGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), mat);
    this.tunnelContactGlow.position.set(0, -0.12, 0.24);
    this.tunnelContactGlow.visible = false;
    this.mesh.add(this.tunnelContactGlow);
  }

  private updateSparks() {
    const pts = (this.sparkGroup as any)._pointsRef as THREE.Points | undefined;
    if (!pts || this.chainLength <= 0) return;

    this.sparkGroup.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.sparkGroup.quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.heading + this.driftVisualAngle,
    );
    if (Math.abs(this.tunnelRoll) > 0.0001) {
      this.sparkGroup.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.tunnelRoll),
      );
    }

    const eMat = this.boostExhaust.material as THREE.MeshBasicMaterial;
    if (this.speedBoostActive) {
      eMat.opacity = 0.6 + Math.sin(performance.now() / 80) * 0.25;
      const s = 0.8 + Math.sin(performance.now() / 90) * 0.2;
      this.boostExhaust.scale.set(s, s, s);
    } else {
      eMat.opacity = 0;
    }

    const tunnelContact = Math.abs(this.tunnelRoll);
    const contactMat = this.tunnelContactGlow.material as THREE.MeshBasicMaterial;
    if (tunnelContact > 0.45 && Math.abs(this.speed) > 8) {
      this.tunnelContactGlow.visible = true;
      const pulse = 0.45 + 0.35 * Math.sin(performance.now() / 70);
      contactMat.opacity = THREE.MathUtils.clamp((tunnelContact - 0.45) * 0.6 + pulse * 0.25, 0, 0.9);
      const c = 0.85 + 0.15 * Math.sin(performance.now() / 110);
      this.tunnelContactGlow.scale.set(1.0 + c * 0.2, 1.0, 1.0);
    } else {
      this.tunnelContactGlow.visible = false;
      contactMat.opacity = 0;
    }

    if (!this.drifting || this.driftLevel === DRIFT_LEVEL.NONE) {
      this.sparkGroup.visible = false;
      return;
    }
    this.sparkGroup.visible = true;

    let brightness = 0.35;
    if (this.driftLevel === DRIFT_LEVEL.ORANGE) brightness = 0.7;
    if (this.driftLevel === DRIFT_LEVEL.PURPLE) brightness = 1.0;

    const pMat = pts.material as THREE.PointsMaterial;
    pMat.opacity = brightness;
    pMat.size = 0.12 + brightness * 0.12;

    const posAttr = pts.geometry.attributes.position as THREE.BufferAttribute;
    const side = this.driftDirection;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setXYZ(
        i,
        side * (0.35 + Math.random() * 0.45),
        -0.08 + Math.random() * 0.25,
        -0.6 - Math.random() * 1.3,
      );
    }
    posAttr.needsUpdate = true;
  }

  getPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z);
  }

  getBodySegmentPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    // "Body" means non-head segments: indices 1..n-1
    for (let i = 1; i < this.chainLength; i++) {
      const b = this.segmentBodies[i];
      out.push(new THREE.Vector3(b.position.x, b.position.y, b.position.z));
    }
    return out;
  }

  getQuaternion(): THREE.Quaternion {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
  }

  reset(position: CANNON.Vec3, rotation: number) {
    this.heading = rotation;
    this.speed = 0;
    this.currentSpeed = 0;
    this.lap = 0;
    this.lastCheckpoint = -1;
    this.finished = false;
    this.finishTime = 0;
    this.speedBoostActive = false;
    this.slowActive = false;
    this.drifting = false;
    this.driftCharge = 0;
    this.driftLevel = DRIFT_LEVEL.NONE;
    this.driftVisualAngle = 0;
    this.tunnelRoll = 0;
    if (this.tunnelContactGlow) {
      this.tunnelContactGlow.visible = false;
      (this.tunnelContactGlow.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    this.airborne = false;
    this.airborneTimer = 0;
    this.airborneElapsed = 0;
    this.hopTimer = 0;
    this.hopOffset = 0;
    this.setChainLength(this.startBlocks);
    this.placeSegmentsAtStart(position, rotation);
    for (let i = 0; i < this.segmentRenderY.length; i++) {
      this.segmentRenderY[i] = position.y;
      this.segmentFloorY[i] = position.y;
    }
  }

  wallBounce(factor: number) {
    this.speed *= factor;
  }

  launch(upVelocity: number) {
    if (this.airborne || this.eliminated || this.chainLength <= 0) return;
    this.airborne = true;
    this.airborneTimer = 3.0;
    this.airborneElapsed = 0;
    for (let i = 0; i < this.chainLength; i++) {
      this.segmentBodies[i].velocity.y = upVelocity * (1 - i * 0.05);
    }
  }

  private buildSparkParticles() {
    const count = 20;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.0,
    });
    const points = new THREE.Points(geom, mat);
    this.sparkGroup.add(points);
    (this.sparkGroup as any)._pointsRef = points;
    this.sparkGroup.visible = false;
  }
}
