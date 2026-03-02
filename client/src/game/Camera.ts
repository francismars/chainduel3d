import * as THREE from 'three';

export class FollowCamera {
  public camera: THREE.PerspectiveCamera;

  private readonly height      = 5;
  private readonly distance    = 10;
  private readonly lookAhead   = 10;
  private readonly lookHeight  = 1.5;
  private readonly smoothPos   = 6;
  private readonly smoothLook  = 8;

  private readonly baseFov     = 75;
  private readonly maxFov      = 92;
  private readonly maxRoll     = 0.04;   // ~2.3 degrees

  private currentPosition = new THREE.Vector3();
  private currentLookAt   = new THREE.Vector3();
  private lookBack = false;

  private currentFov = 75;
  private currentRoll = 0;
  private driftOffsetX = 0;
  private boostPullTimer = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.currentFov = this.baseFov;
  }

  setLookBack(val: boolean) { this.lookBack = val; }

  update(
    targetPos: THREE.Vector3,
    targetQuat: THREE.Quaternion,
    dt: number,
    speed = 0,
    maxSpeed = 28,
    drifting = false,
    driftDirection = 0,
    boosting = false,
    tunnelRoll = 0,
  ) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(targetQuat);
    const rightVec = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    // FOV: widen at high speed
    const speedRatio = Math.min(Math.abs(speed) / maxSpeed, 1);
    const targetFov = THREE.MathUtils.lerp(this.baseFov, this.maxFov, speedRatio);
    this.currentFov += (targetFov - this.currentFov) * Math.min(dt * 4, 1);
    this.camera.fov = this.currentFov;

    // Roll: tilt into turns
    const left = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).dot(rightVec) > 0;
    const turnDir = drifting ? driftDirection : (left ? -1 : 0);
    const tunnelRollClamped = THREE.MathUtils.clamp(tunnelRoll, -0.95, 0.95);
    const targetRoll = turnDir * this.maxRoll * speedRatio + tunnelRollClamped * 0.45;
    const rollLerp = Math.abs(tunnelRollClamped) < 0.05 ? 5.6 : 4.8;
    this.currentRoll += (targetRoll - this.currentRoll) * Math.min(dt * rollLerp, 1);

    // Drift offset: shift camera to outside of turn
    const targetDriftOffset = drifting ? -driftDirection * 1.0 : 0;
    this.driftOffsetX += (targetDriftOffset - this.driftOffsetX) * Math.min(dt * 4, 1);

    // Boost pull: lower + closer
    if (boosting) this.boostPullTimer = 0.5;
    this.boostPullTimer = Math.max(0, this.boostPullTimer - dt);
    const boostFactor = this.boostPullTimer > 0 ? Math.min(this.boostPullTimer * 4, 1) : 0;
    const boostDistance = -boostFactor * 1.5;
    const boostHeight = -boostFactor * 1.0;

    let camOffset: THREE.Vector3;
    let lookTarget: THREE.Vector3;

    if (this.lookBack) {
      camOffset = targetPos.clone()
        .add(fwd.clone().multiplyScalar(this.distance + boostDistance))
        .add(new THREE.Vector3(0, this.height + boostHeight, 0))
        .add(rightVec.clone().multiplyScalar(this.driftOffsetX));
      lookTarget = targetPos.clone()
        .add(fwd.clone().multiplyScalar(-this.lookAhead))
        .add(new THREE.Vector3(0, this.lookHeight, 0));
    } else {
      camOffset = targetPos.clone()
        .add(fwd.clone().multiplyScalar(-(this.distance + boostDistance)))
        .add(new THREE.Vector3(0, this.height + boostHeight, 0))
        .add(rightVec.clone().multiplyScalar(this.driftOffsetX));
      lookTarget = targetPos.clone()
        .add(fwd.clone().multiplyScalar(this.lookAhead))
        .add(new THREE.Vector3(0, this.lookHeight, 0));
    }

    const tPos  = 1 - Math.exp(-this.smoothPos * dt);
    const tLook = 1 - Math.exp(-this.smoothLook * dt);
    this.currentPosition.lerp(camOffset, tPos);
    this.currentLookAt.lerp(lookTarget, tLook);

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);

    // Apply roll
    this.camera.rotateZ(this.currentRoll);
    this.camera.updateProjectionMatrix();
  }

  reset(pos: THREE.Vector3, quat: THREE.Quaternion) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    this.currentPosition.copy(pos)
      .add(fwd.clone().multiplyScalar(-this.distance))
      .add(new THREE.Vector3(0, this.height, 0));
    this.currentLookAt.copy(pos)
      .add(fwd.clone().multiplyScalar(this.lookAhead))
      .add(new THREE.Vector3(0, this.lookHeight, 0));
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
    this.currentFov = this.baseFov;
    this.currentRoll = 0;
    this.driftOffsetX = 0;
    this.boostPullTimer = 0;
  }
}
