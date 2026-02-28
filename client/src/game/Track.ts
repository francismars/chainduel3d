import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  buildItemBoxPositions,
  buildSimCheckpoints,
  buildSimMainTrackPoints,
  buildSimStartFrame,
  buildSimStartSlotPose,
  buildSimShortcutTrackPoints,
  type SimTrackPoint,
} from 'shared/sim';

const TRACK_EDITOR_STORAGE_KEY = 'chainrace.trackEditorParams.v1';
const TRACK_CUSTOM_LAYOUT_STORAGE_KEY = 'chainrace.trackCustomLayout.v1';

export interface TrackControlPoint {
  x: number;
  z: number;
  w: number;
  e: number;
  ramp?: boolean;
  bridge?: boolean;
  noRails?: boolean;
}

export interface TrackShortcutControlPoint {
  x: number;
  z: number;
  e: number;
}

export interface TrackCustomLayout {
  main: TrackControlPoint[];
  shortcut?: TrackShortcutControlPoint[];
}

export interface TrackEditorParams {
  numSegments: number;
  baseRadius: number;
  radiusWaveA: number;
  radiusWaveB: number;
  radiusWaveC: number;
  loopLiftAmp: number;
  undulationA: number;
  undulationB: number;
  widthBase: number;
  widthWaveA: number;
  widthWaveB: number;
}

export const DEFAULT_TRACK_EDITOR_PARAMS: TrackEditorParams = {
  numSegments: 360,
  baseRadius: 104,
  radiusWaveA: 6,
  radiusWaveB: 4,
  radiusWaveC: 2.2,
  loopLiftAmp: 8,
  undulationA: 1.4,
  undulationB: 1.1,
  widthBase: 11.8,
  widthWaveA: 0.9,
  widthWaveB: 0.5,
};

export interface TrackPointFlags {
  ramp?: boolean;
  bridge?: boolean;
  noRails?: boolean;
}

export interface TrackPoint {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  width: number;
  flags: TrackPointFlags;
}

export interface Checkpoint {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  width: number;
  index: number;
}

export interface TrackInfo {
  elevation: number;
  right: THREE.Vector3;
  offset: number;
  halfWidth: number;
  flags: TrackPointFlags;
  isShortcut: boolean;
}

export class Track {
  public mesh: THREE.Group;
  public checkpoints: Checkpoint[] = [];
  public startPositions: CANNON.Vec3[];
  public startRotation: number;
  public itemBoxPositions: THREE.Vector3[] = [];

  public trackPoints: TrackPoint[] = [];
  private shortcutPoints: TrackPoint[] = [];
  private allPoints: TrackPoint[] = [];
  private shortcutStartIdx = 0;
  private floatingParticles!: THREE.Points;
  private feeTileMaterials: THREE.MeshBasicMaterial[] = [];
  private feeTotems: Array<{
    ring: THREE.Mesh;
    ctx: CanvasRenderingContext2D;
    tex: THREE.CanvasTexture;
    label: string;
  }> = [];
  private dataSculptures!: THREE.Group;
  private blockHelixGroup!: THREE.Group;
  private helixBlocks: Array<{
    cube: THREE.Mesh;
    wire: THREE.Mesh;
    size: number;
    targetY: number;
    baseY: number;
  }> = [];
  private mempoolSlabGroup!: THREE.Group;
  private mempoolSlabs: THREE.Mesh[] = [];
  private centerpieceAnchor = new THREE.Vector3(0, 0, 0);
  private beaconLights: THREE.PointLight[] = [];
  private beaconHalos: THREE.Mesh[] = [];
  private beaconBeams: THREE.Mesh[] = [];
  private beaconFlares: THREE.Sprite[] = [];
  private editorParams: TrackEditorParams;
  private customLayoutOverride: TrackCustomLayout | null;
  private useStoredCustomLayout: boolean;

  constructor(
    scene: THREE.Scene,
    world: CANNON.World,
    customLayoutOverride?: TrackCustomLayout | null,
    options?: { useStoredCustomLayout?: boolean },
  ) {
    this.mesh = new THREE.Group();
    this.editorParams = Track.getEditorParams();
    this.customLayoutOverride = customLayoutOverride ?? null;
    this.useStoredCustomLayout = options?.useStoredCustomLayout ?? true;
    this.startPositions = [new CANNON.Vec3(), new CANNON.Vec3(), new CANNON.Vec3(), new CANNON.Vec3()];
    this.startRotation = 0;

    this.generateTrackPoints();
    this.generateShortcut();
    this.allPoints = [...this.trackPoints, ...this.shortcutPoints];
    this.shortcutStartIdx = this.trackPoints.length;
    this.computeCenterpieceAnchor();

    this.buildTrackMesh();
    this.buildShortcutMesh();
    this.buildTrackPhysics(world);
    this.buildGroundPlane(world);
    this.buildCheckpoints();
    this.placeItemBoxes();
    this.buildDecorations();
    this.buildRampVisuals();
    this.buildBridgeVisuals();
    this.buildDataOverlays();

    scene.add(this.mesh);
  }

  // ─── TRACK LAYOUT ──────────────────────────────────────────────

  private generateTrackPoints() {
    const custom = this.customLayoutOverride ?? (this.useStoredCustomLayout ? Track.getCustomLayout() : null);
    const simPoints = buildSimMainTrackPoints(
      custom as any,
      custom ? undefined : this.editorParams as any,
    );
    this.trackPoints = this.mapSimPointsToTrackPoints(simPoints, custom?.main);
    this.updateStartGridFromSimPoints(simPoints);
  }

  private generateTrackFromControlPoints(controlPoints: TrackControlPoint[]) {
    const splineVecs = controlPoints.map(
      cp => new THREE.Vector3(cp.x, cp.e, cp.z),
    );
    const spline = new THREE.CatmullRomCurve3(splineVecs, true, 'catmullrom', 0.5);

    const widths = controlPoints.map(cp => cp.w);
    const flags: TrackPointFlags[] = controlPoints.map(cp => ({
      ramp: cp.ramp ?? false,
      bridge: cp.bridge ?? false,
      noRails: cp.noRails ?? false,
    }));

    const numSegments = Math.max(180, Math.min(900, controlPoints.length * 18));
    const points: TrackPoint[] = [];

    for (let i = 0; i < numSegments; i++) {
      const t = i / numSegments;
      const pos = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();

      const cpFloat = t * controlPoints.length;
      const cpIdx = Math.floor(cpFloat) % controlPoints.length;
      const cpNext = (cpIdx + 1) % controlPoints.length;
      const cpT = cpFloat - Math.floor(cpFloat);
      const width = widths[cpIdx] * (1 - cpT) + widths[cpNext] * cpT;
      const nearestCp = Math.round(cpFloat) % controlPoints.length;

      points.push({
        position: pos,
        direction: new THREE.Vector3(tangent.x, 0, tangent.z).normalize(),
        width,
        flags: { ...flags[nearestCp] },
      });
    }

    this.trackPoints = points;
    this.updateStartGridFromTrackPoints(points);
  }

  private updateStartGridFromTrackPoints(points: TrackPoint[]) {
    const simPoints = points.map<SimTrackPoint>(p => ({
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      dirX: p.direction.x,
      dirZ: p.direction.z,
      width: p.width,
      ramp: !!p.flags.ramp,
    }));
    this.updateStartGridFromSimPoints(simPoints);
  }

  private updateStartGridFromSimPoints(points: SimTrackPoint[]) {
    const frame = buildSimStartFrame(points);
    for (let i = 0; i < this.startPositions.length; i++) {
      const slot = buildSimStartSlotPose(points, i);
      this.startPositions[i] = new CANNON.Vec3(
        slot.x,
        slot.y,
        slot.z,
      );
    }
    this.startRotation = frame.heading;
  }

  static getEditorParams(): TrackEditorParams {
    try {
      const raw = localStorage.getItem(TRACK_EDITOR_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_TRACK_EDITOR_PARAMS };
      const parsed = JSON.parse(raw) as Partial<TrackEditorParams>;
      return {
        numSegments: parsed.numSegments ?? DEFAULT_TRACK_EDITOR_PARAMS.numSegments,
        baseRadius: parsed.baseRadius ?? DEFAULT_TRACK_EDITOR_PARAMS.baseRadius,
        radiusWaveA: parsed.radiusWaveA ?? DEFAULT_TRACK_EDITOR_PARAMS.radiusWaveA,
        radiusWaveB: parsed.radiusWaveB ?? DEFAULT_TRACK_EDITOR_PARAMS.radiusWaveB,
        radiusWaveC: parsed.radiusWaveC ?? DEFAULT_TRACK_EDITOR_PARAMS.radiusWaveC,
        loopLiftAmp: parsed.loopLiftAmp ?? DEFAULT_TRACK_EDITOR_PARAMS.loopLiftAmp,
        undulationA: parsed.undulationA ?? DEFAULT_TRACK_EDITOR_PARAMS.undulationA,
        undulationB: parsed.undulationB ?? DEFAULT_TRACK_EDITOR_PARAMS.undulationB,
        widthBase: parsed.widthBase ?? DEFAULT_TRACK_EDITOR_PARAMS.widthBase,
        widthWaveA: parsed.widthWaveA ?? DEFAULT_TRACK_EDITOR_PARAMS.widthWaveA,
        widthWaveB: parsed.widthWaveB ?? DEFAULT_TRACK_EDITOR_PARAMS.widthWaveB,
      };
    } catch {
      return { ...DEFAULT_TRACK_EDITOR_PARAMS };
    }
  }

  static setEditorParams(next: TrackEditorParams) {
    localStorage.setItem(TRACK_EDITOR_STORAGE_KEY, JSON.stringify(next));
  }

  static resetEditorParams() {
    localStorage.removeItem(TRACK_EDITOR_STORAGE_KEY);
  }

  static getCustomLayout(): TrackCustomLayout | null {
    try {
      const raw = localStorage.getItem(TRACK_CUSTOM_LAYOUT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as TrackCustomLayout;
      if (!parsed || !Array.isArray(parsed.main) || parsed.main.length < 4) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  static setCustomLayout(layout: TrackCustomLayout) {
    localStorage.setItem(TRACK_CUSTOM_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }

  static resetCustomLayout() {
    localStorage.removeItem(TRACK_CUSTOM_LAYOUT_STORAGE_KEY);
  }

  private computeCenterpieceAnchor() {
    if (this.trackPoints.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const pt of this.trackPoints) {
      minX = Math.min(minX, pt.position.x);
      maxX = Math.max(maxX, pt.position.x);
      minZ = Math.min(minZ, pt.position.z);
      maxZ = Math.max(maxZ, pt.position.z);
    }
    this.centerpieceAnchor.set((minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5);
  }

  // ─── SHORTCUT PATH ─────────────────────────────────────────────

  private generateShortcut() {
    const custom = this.customLayoutOverride ?? (this.useStoredCustomLayout ? Track.getCustomLayout() : null);
    const simShortcut = buildSimShortcutTrackPoints(custom as any);
    this.shortcutPoints = this.mapSimPointsToTrackPoints(simShortcut);
  }

  private mapSimPointsToTrackPoints(simPoints: SimTrackPoint[], controlPoints?: TrackControlPoint[]): TrackPoint[] {
    const points: TrackPoint[] = [];
    const n = simPoints.length;
    for (let i = 0; i < n; i++) {
      const sp = simPoints[i];
      const flags: TrackPointFlags = { ramp: !!sp.ramp, bridge: false, noRails: false };
      if (controlPoints && controlPoints.length > 0) {
        const cpFloat = (i / Math.max(1, n)) * controlPoints.length;
        const nearestCp = Math.round(cpFloat) % controlPoints.length;
        const cp = controlPoints[nearestCp];
        flags.ramp = cp.ramp ?? flags.ramp;
        flags.bridge = !!cp.bridge;
        flags.noRails = !!cp.noRails;
      } else {
        const t = i / Math.max(1, n);
        const theta = t * Math.PI * 4;
        const loopLift = -this.editorParams.loopLiftAmp * Math.sin(theta * 0.5);
        flags.bridge = loopLift > this.editorParams.loopLiftAmp * 0.4;
      }
      points.push({
        position: new THREE.Vector3(sp.x, sp.y, sp.z),
        direction: new THREE.Vector3(sp.dirX, 0, sp.dirZ).normalize(),
        width: sp.width,
        flags,
      });
    }
    return points;
  }

  // ─── TRACK MESH ────────────────────────────────────────────────

  private buildTrackMesh() {
    this.buildRoadSurface(this.trackPoints, true);
    this.buildTrackBorders(this.trackPoints);
    this.buildStartLine(this.trackPoints[0]);
  }

  private buildShortcutMesh() {
    this.buildRoadSurface(this.shortcutPoints, false);
  }

  private buildRoadSurface(pts: TrackPoint[], closed: boolean) {
    const n = pts.length;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < n; i++) {
      const pt = pts[i];
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), pt.direction)
        .normalize();
      const halfW = pt.width / 2;

      const leftPos = pt.position.clone().add(right.clone().multiplyScalar(-halfW));
      const rightPos = pt.position.clone().add(right.clone().multiplyScalar(halfW));

      // Bank corners
      if (i > 0 && i < n - 1) {
        const prevDir = pts[i - 1].direction;
        const nextDir = pts[(i + 1) % n].direction;
        const curvature = prevDir.clone().cross(nextDir).y;
        const bankAngle = THREE.MathUtils.clamp(curvature * 15, -0.3, 0.3);
        leftPos.y += bankAngle * halfW * 0.3;
        rightPos.y -= bankAngle * halfW * 0.3;
      }

      positions.push(leftPos.x, leftPos.y + 0.01, leftPos.z);
      positions.push(rightPos.x, rightPos.y + 0.01, rightPos.z);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, i / n * 40, 1, i / n * 40);

      if (i < n - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }
    if (closed) {
      const base = (n - 1) * 2;
      indices.push(base, base + 1, 0);
      indices.push(base + 1, 1, 0);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 1;
    const gridSize = 32;
    for (let gx = 0; gx <= 512; gx += gridSize) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 512); ctx.stroke();
    }
    for (let gy = 0; gy <= 512; gy += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(512, gy); ctx.stroke();
    }

    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 12]);
    ctx.beginPath(); ctx.moveTo(256, 0); ctx.lineTo(256, 512); ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(4, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(508, 0); ctx.lineTo(508, 512); ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    const roadMat = new THREE.MeshStandardMaterial({
      map: texture,
      metalness: 0.0,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });

    const roadMesh = new THREE.Mesh(geom, roadMat);
    roadMesh.receiveShadow = true;
    this.mesh.add(roadMesh);
  }

  private buildTrackBorders(pts: TrackPoint[]) {
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x444444,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.5,
    });

    const wallMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
    });

    for (const side of [-1, 1]) {
      const borderPositions: THREE.Vector3[] = [];
      for (const pt of pts) {
        if (pt.flags.noRails) continue;
        const right = new THREE.Vector3()
          .crossVectors(new THREE.Vector3(0, 1, 0), pt.direction)
          .normalize();
        const pos = pt.position.clone().add(
          right.clone().multiplyScalar(side * pt.width / 2),
        );
        borderPositions.push(pos);
      }
      if (borderPositions.length < 2) continue;
      borderPositions.push(borderPositions[0].clone());

      const curve = new THREE.CatmullRomCurve3(borderPositions, false);
      const tubeGeom = new THREE.TubeGeometry(curve, borderPositions.length * 2, 0.12, 6, false);
      const tube = new THREE.Mesh(tubeGeom, borderMat);
      tube.position.y = 0.3;
      tube.castShadow = true;
      this.mesh.add(tube);

      // Translucent wall panels
      const wallPositions: number[] = [];
      const wallIndices: number[] = [];
      for (let i = 0; i < borderPositions.length - 1; i++) {
        const p0 = borderPositions[i];
        const p1 = borderPositions[i + 1];
        const bi = i * 4;
        wallPositions.push(p0.x, p0.y + 0.01, p0.z);
        wallPositions.push(p0.x, p0.y + 2.0, p0.z);
        wallPositions.push(p1.x, p1.y + 0.01, p1.z);
        wallPositions.push(p1.x, p1.y + 2.0, p1.z);
        wallIndices.push(bi, bi + 1, bi + 2, bi + 1, bi + 3, bi + 2);
      }
      const wallGeom = new THREE.BufferGeometry();
      wallGeom.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
      wallGeom.computeVertexNormals();
      wallGeom.setIndex(wallIndices);
      this.mesh.add(new THREE.Mesh(wallGeom, wallMat));
    }
  }

  private buildStartLine(startPt: TrackPoint) {
    // Anchor visuals to the actual spawn row so the banner/stripe always match
    // where racers begin, even on custom/seamed track layouts.
    const up = new THREE.Vector3(0, 1, 0);
    const yaw = this.startRotation;
    const direction = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
    const right = new THREE.Vector3().crossVectors(up, direction).normalize();
    const spawnCenter = this.startPositions.reduce(
      (acc, p) => acc.add(new THREE.Vector3(p.x, p.y, p.z)),
      new THREE.Vector3(),
    ).multiplyScalar(1 / Math.max(1, this.startPositions.length));
    const framePos = spawnCenter.clone().setY(startPt.position.y);
    const spawnRowSpan = this.startPositions.length >= 2
      ? new THREE.Vector3(
        this.startPositions[0].x - this.startPositions[this.startPositions.length - 1].x,
        0,
        this.startPositions[0].z - this.startPositions[this.startPositions.length - 1].z,
      ).length()
      : startPt.width * 0.8;
    const bannerWidth = Math.max(startPt.width + 1, spawnRowSpan + 2.2);

    const archMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x333333,
      emissiveIntensity: 0.5,
      metalness: 0.2,
      roughness: 0.6,
    });

    const pillarGeom = new THREE.CylinderGeometry(0.2, 0.2, 5, 8);
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeom, archMat);
      pillar.position
        .copy(framePos)
        .add(right.clone().multiplyScalar(s * (bannerWidth / 2 + 0.3)));
      pillar.position.y += 2.5;
      pillar.castShadow = true;
      this.mesh.add(pillar);
    }

    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(bannerWidth, 0.3, 0.3),
      archMat,
    );
    crossbar.position.copy(framePos);
    crossbar.position.y = 5;
    crossbar.rotation.set(0, yaw, 0);
    this.mesh.add(crossbar);

    // Checkered start line on ground
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = 128;
    lineCanvas.height = 128;
    const lctx = lineCanvas.getContext('2d')!;
    const tileSize = 16;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        lctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#000000';
        lctx.fillRect(c * tileSize, r * tileSize, tileSize, tileSize);
      }
    }
    const lineTex = new THREE.CanvasTexture(lineCanvas);
    const lineGeom = new THREE.PlaneGeometry(Math.max(startPt.width * 0.95, spawnRowSpan + 1.2), 2);
    const lineMat = new THREE.MeshStandardMaterial({
      map: lineTex,
      side: THREE.DoubleSide,
    });
    const line = new THREE.Mesh(lineGeom, lineMat);
    line.position.copy(framePos);
    line.position.y += 0.02;
    // Keep stripe strictly on ground while orienting it to race direction.
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const qFlat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    line.quaternion.copy(qYaw).multiply(qFlat);
    this.mesh.add(line);
  }

  // ─── RAMP & BRIDGE VISUALS ─────────────────────────────────────

  private buildRampVisuals() {
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x666666,
      emissiveIntensity: 0.8,
      metalness: 0.4,
      roughness: 0.3,
      transparent: true,
      opacity: 0.7,
    });

    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });

    for (let i = 0; i < this.trackPoints.length; i++) {
      const pt = this.trackPoints[i];
      if (!pt.flags.ramp) continue;

      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), pt.direction)
        .normalize();

      // Angled ramp surface
      const rampGeom = new THREE.PlaneGeometry(pt.width * 0.9, 6);
      const ramp = new THREE.Mesh(rampGeom, rampMat);
      ramp.position.copy(pt.position);
      ramp.position.y += 1.5;

      // Tilt upward in the direction of travel
      ramp.lookAt(pt.position.clone().add(pt.direction));
      ramp.rotation.x = -Math.PI / 2 + 0.35;
      this.mesh.add(ramp);

      // Glowing edge at ramp lip
      const edgeGeom = new THREE.BoxGeometry(pt.width, 0.15, 0.15);
      const edge = new THREE.Mesh(edgeGeom, edgeMat);
      edge.position.copy(pt.position);
      edge.position.y += 3.0;
      edge.position.add(pt.direction.clone().multiplyScalar(2));
      edge.lookAt(edge.position.clone().add(right));
      this.mesh.add(edge);

      // Arrow markers on ramp
      const arrowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
      });
      for (let a = -1; a <= 1; a += 2) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.3, 1.0, 4),
          arrowMat,
        );
        arrow.position.copy(pt.position);
        arrow.position.add(right.clone().multiplyScalar(a * 2));
        arrow.position.y += 0.5;
        arrow.rotation.x = -Math.PI / 2;
        this.mesh.add(arrow);
      }
    }
  }

  private buildBridgeVisuals() {
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
      metalness: 0.3,
      roughness: 0.5,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
    });

    const bridgePoints = this.trackPoints.filter(p => p.flags.bridge);
    const step = Math.max(1, Math.floor(bridgePoints.length / 6));

    for (let i = 0; i < bridgePoints.length; i += step) {
      const pt = bridgePoints[i];
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), pt.direction)
        .normalize();

      for (const s of [-1, 1]) {
        const pillarHeight = pt.position.y + 5;
        const pillarGeom = new THREE.CylinderGeometry(0.15, 0.25, pillarHeight, 6);
        const pillar = new THREE.Mesh(pillarGeom, pillarMat);
        const offset = right.clone().multiplyScalar(s * (pt.width / 2 + 0.5));
        pillar.position.copy(pt.position).add(offset);
        pillar.position.y = -pillarHeight / 2 + pt.position.y;
        pillar.castShadow = true;
        this.mesh.add(pillar);
      }

      // Underside glow strip
      const stripGeom = new THREE.PlaneGeometry(pt.width, 1);
      const strip = new THREE.Mesh(stripGeom, glowMat);
      strip.position.copy(pt.position);
      strip.position.y -= 0.3;
      strip.rotation.x = Math.PI / 2;
      this.mesh.add(strip);
    }
  }

  // ─── PHYSICS ───────────────────────────────────────────────────

  private buildTrackPhysics(_world: CANNON.World) {
    // Wall collisions handled in code via constrainToTrack()
  }

  // ─── TRACK INFO & CONSTRAIN ────────────────────────────────────

  getTrackInfo(pos: THREE.Vector3): TrackInfo {
    const all = this.allPoints;
    const n = all.length;
    let bestDist = Infinity;
    let bestIdx = 0;

    // Find nearest point across main + shortcut, using 3D distance
    for (let i = 0; i < n; i++) {
      const tp = all[i].position;
      const dx = pos.x - tp.x;
      const dy = pos.y - tp.y;
      const dz = pos.z - tp.z;
      const d = dx * dx + dy * dy * 0.5 + dz * dz; // Weight Y less to avoid snapping to bridge when underneath
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    const isShortcut = bestIdx >= this.shortcutStartIdx;
    const localPoints = isShortcut ? this.shortcutPoints : this.trackPoints;
    const localIdx = isShortcut ? bestIdx - this.shortcutStartIdx : bestIdx;
    const localN = localPoints.length;
    const closed = !isShortcut;

    const tp = localPoints[localIdx];
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), tp.direction)
      .normalize();
    const toKart = new THREE.Vector3(pos.x - tp.position.x, 0, pos.z - tp.position.z);
    const offset = toKart.dot(right);

    // Spine projection for smooth elevation
    const fwdDot = toKart.dot(tp.direction);
    let idxA: number, idxB: number;

    if (closed) {
      const nextIdx = (localIdx + 1) % localN;
      const prevIdx = (localIdx - 1 + localN) % localN;
      if (fwdDot >= 0) { idxA = localIdx; idxB = nextIdx; }
      else { idxA = prevIdx; idxB = localIdx; }
    } else {
      const nextIdx = Math.min(localIdx + 1, localN - 1);
      const prevIdx = Math.max(localIdx - 1, 0);
      if (fwdDot >= 0) { idxA = localIdx; idxB = nextIdx; }
      else { idxA = prevIdx; idxB = localIdx; }
    }

    const pA = localPoints[idxA].position;
    const pB = localPoints[idxB].position;
    const segDx = pB.x - pA.x;
    const segDz = pB.z - pA.z;
    const segLen2 = segDx * segDx + segDz * segDz;

    let t: number;
    if (segLen2 > 0.001) {
      const projDx = pos.x - pA.x;
      const projDz = pos.z - pA.z;
      t = Math.max(0, Math.min(1, (projDx * segDx + projDz * segDz) / segLen2));
    } else {
      t = 0;
    }

    // Catmull-Rom elevation interpolation
    let idxPrev: number, idxNext: number;
    if (closed) {
      idxPrev = (idxA - 1 + localN) % localN;
      idxNext = (idxB + 1) % localN;
    } else {
      idxPrev = Math.max(idxA - 1, 0);
      idxNext = Math.min(idxB + 1, localN - 1);
    }

    const y0 = localPoints[idxPrev].position.y;
    const y1 = localPoints[idxA].position.y;
    const y2 = localPoints[idxB].position.y;
    const y3 = localPoints[idxNext].position.y;

    const t2 = t * t;
    const t3 = t2 * t;
    const elevation = 0.5 * (
      (2 * y1) +
      (-y0 + y2) * t +
      (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
      (-y0 + 3 * y1 - 3 * y2 + y3) * t3
    );

    return {
      elevation,
      right,
      offset,
      halfWidth: tp.width / 2,
      flags: tp.flags,
      isShortcut,
    };
  }

  constrainToTrack(body: CANNON.Body, airborne: boolean): { hitWall: boolean; info: TrackInfo } {
    const pos = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
    const info = this.getTrackInfo(pos);
    const margin = info.halfWidth - 0.8;

    // Don't pin Y when airborne (jumps)
    if (!airborne) {
      const targetY = info.elevation + 0.5;
      const lerpRate = 0.25;
      body.position.y += (targetY - body.position.y) * lerpRate;
      body.velocity.y = 0;
    }

    // Optional no-rail sections can let players fall, but shortcut itself
    // should remain bounded so races are consistently finishable.
    if (info.flags.noRails) {
      return { hitWall: false, info };
    }

    let hitWall = false;
    if (Math.abs(info.offset) > margin) {
      const sign = info.offset > 0 ? 1 : -1;
      const push = Math.abs(info.offset) - margin;
      body.position.x -= info.right.x * sign * push;
      body.position.z -= info.right.z * sign * push;
      hitWall = true;
    }
    return { hitWall, info };
  }

  clampPositionToTrack(position: THREE.Vector3): THREE.Vector3 {
    const info = this.getTrackInfo(position);
    const out = position.clone();
    out.y = info.elevation + 0.5;
    return out;
  }

  // ─── GROUND ────────────────────────────────────────────────────

  private buildGroundPlane(world: CANNON.World) {
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: new CANNON.Material({ friction: 0, restitution: 0.1 }),
    });
    groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    groundBody.position.y = -10;
    world.addBody(groundBody);

    const gridSize = 600;
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 512;
    gridCanvas.height = 512;
    const gctx = gridCanvas.getContext('2d')!;

    gctx.fillStyle = '#020202';
    gctx.fillRect(0, 0, 512, 512);
    gctx.strokeStyle = '#0e0e0e';
    gctx.lineWidth = 1;
    const cellSize = 32;
    for (let x = 0; x <= 512; x += cellSize) {
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, 512); gctx.stroke();
    }
    for (let y = 0; y <= 512; y += cellSize) {
      gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(512, y); gctx.stroke();
    }

    const gridTex = new THREE.CanvasTexture(gridCanvas);
    gridTex.wrapS = THREE.RepeatWrapping;
    gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(gridSize / 10, gridSize / 10);

    const groundGeom = new THREE.PlaneGeometry(gridSize, gridSize);
    const groundMat = new THREE.MeshStandardMaterial({
      map: gridTex,
      metalness: 0.0,
      roughness: 0.95,
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    ground.receiveShadow = true;
    this.mesh.add(ground);
  }

  // ─── CHECKPOINTS ───────────────────────────────────────────────

  private buildCheckpoints() {
    const simPoints = this.toSimTrackPoints(this.trackPoints);
    const simCheckpoints = buildSimCheckpoints(simPoints);
    for (let i = 0; i < simCheckpoints.length; i++) {
      const cp = simCheckpoints[i];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let j = 0; j < this.trackPoints.length; j++) {
        const p = this.trackPoints[j];
        const dx = p.position.x - cp.x;
        const dz = p.position.z - cp.z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }
      const pt = this.trackPoints[bestIdx];
      this.checkpoints.push({
        position: pt.position.clone(),
        direction: pt.direction.clone(),
        width: cp.width,
        index: i,
      });
    }
  }

  // ─── ITEM BOXES ────────────────────────────────────────────────

  private placeItemBoxes() {
    const simPoints = this.toSimTrackPoints(this.trackPoints);
    const itemPositions = buildItemBoxPositions(simPoints);
    for (const p of itemPositions) {
      this.itemBoxPositions.push(new THREE.Vector3(p.x, p.y, p.z));
    }
  }

  private toSimTrackPoints(points: TrackPoint[]): SimTrackPoint[] {
    return points.map(p => ({
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      dirX: p.direction.x,
      dirZ: p.direction.z,
      width: p.width,
      ramp: !!p.flags.ramp,
    }));
  }

  // ─── DECORATIONS ───────────────────────────────────────────────

  private buildDecorations() {
    this.buildBlockchainHelices();
    this.buildNetworkNodes();
    this.buildFloatingParticles();
  }

  private buildDataOverlays() {
    this.dataSculptures = new THREE.Group();
    this.dataSculptures.position.copy(this.centerpieceAnchor);
    this.mesh.add(this.dataSculptures);
    this.buildDataMonumentBase();
    this.buildFeeHeatTiles();
    this.buildFeeTotems();
    this.buildLiveBlockHelix();
    this.buildMempoolLayeredSlabs();
  }

  private buildDataMonumentBase() {
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 52, 18, 72),
      new THREE.MeshStandardMaterial({
        color: 0x131313,
        roughness: 0.68,
        metalness: 0.14,
        emissive: 0x222222,
        emissiveIntensity: 0.32,
      }),
    );
    pedestal.position.y = 9;
    pedestal.receiveShadow = true;
    this.dataSculptures.add(pedestal);

    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(56, 72, 56, 8, true),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        transparent: true,
        opacity: 0.78,
        roughness: 0.85,
        metalness: 0.04,
        emissive: 0x222222,
        emissiveIntensity: 0.2,
        side: THREE.DoubleSide,
      }),
    );
    mountain.position.y = 36;
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    this.dataSculptures.add(mountain);

    const topRing = new THREE.Mesh(
      new THREE.TorusGeometry(44, 0.8, 10, 120),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }),
    );
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 18.4;
    this.dataSculptures.add(topRing);

    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(1.2, 1.8, 52, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }),
      );
      pylon.position.set(Math.cos(ang) * 40, 26, Math.sin(ang) * 40);
      this.dataSculptures.add(pylon);
    }

    // Colossal "data titan" silhouette so players feel like ants at its feet.
    const titanMat = new THREE.MeshStandardMaterial({
      color: 0x202020,
      roughness: 0.72,
      metalness: 0.08,
      emissive: 0x2c2c2c,
      emissiveIntensity: 0.22,
    });
    const addPart = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, titanMat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      this.dataSculptures.add(m);
    };

    // legs
    addPart(new THREE.CylinderGeometry(5.8, 7.2, 46, 12), -9.5, 30, 0);
    addPart(new THREE.CylinderGeometry(5.8, 7.2, 46, 12), 9.5, 30, 0);
    // torso + shoulders
    addPart(new THREE.BoxGeometry(32, 40, 15), 0, 68, 0);
    addPart(new THREE.BoxGeometry(40, 8, 12), 0, 88, 0);
    // arms
    addPart(new THREE.BoxGeometry(10.5, 36, 10.5), -26, 64, 0, 0, 0, 0.18);
    addPart(new THREE.BoxGeometry(10.5, 36, 10.5), 26, 64, 0, 0, 0, -0.18);
    // head + crown ring
    addPart(new THREE.BoxGeometry(16, 18, 15), 0, 104, 0);
    const crown = new THREE.Mesh(
      new THREE.TorusGeometry(12, 0.45, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }),
    );
    crown.position.set(0, 115, 0);
    crown.rotation.x = Math.PI / 2;
    this.dataSculptures.add(crown);

    // Beacons disabled: keep centerpiece clean and non-distracting.
  }

  private buildCenterpieceBeacons() {
    const beamTex = this.makeBeamTexture();
    const flareTex = this.makeFlareTexture();

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const radius = 78;
      const bx = Math.cos(ang) * radius;
      const bz = Math.sin(ang) * radius;

      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(1.8, 2.6, 38, 10),
        new THREE.MeshStandardMaterial({
          color: 0x1f1f1f,
          roughness: 0.65,
          metalness: 0.1,
          emissive: 0x303030,
          emissiveIntensity: 0.2,
        }),
      );
      tower.position.set(bx, 19, bz);
      this.dataSculptures.add(tower);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(4.2, 5.8, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.2,
          side: THREE.DoubleSide,
        }),
      );
      halo.position.set(bx, 39, bz);
      halo.rotation.x = -Math.PI / 2;
      this.dataSculptures.add(halo);
      this.beaconHalos.push(halo);

      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xcfe6ff,
        alphaMap: beamTex,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 2.9, 62, 16, 1, true),
        beamMat,
      );
      beam.position.set(bx, 70, bz);
      this.dataSculptures.add(beam);
      this.beaconBeams.push(beam);

      const flare = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: flareTex,
          color: 0xe8f3ff,
          transparent: true,
          opacity: 0.65,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      flare.position.set(bx, 41.5, bz);
      flare.scale.set(16, 16, 1);
      this.dataSculptures.add(flare);
      this.beaconFlares.push(flare);

      const light = new THREE.PointLight(0xe6f0ff, 0.55, 120, 2);
      light.position.set(bx, 41.5, bz);
      this.dataSculptures.add(light);
      this.beaconLights.push(light);
    }
  }

  private makeBeamTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.0, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.5, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.88, 'rgba(255,255,255,0.45)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  private makeFlareTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }

  private buildFeeHeatTiles() {
    for (let i = 0; i < this.trackPoints.length; i += 6) {
      const pt = this.trackPoints[i];
      const mat = new THREE.MeshBasicMaterial({
        color: 0x8a8a8a,
        transparent: true,
        opacity: 0.12,
      });
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(2.5, pt.width * 0.55), 0.03, 2.7),
        mat,
      );
      tile.position.copy(pt.position);
      tile.position.y += 0.06;
      const yaw = Math.atan2(pt.direction.x, pt.direction.z);
      tile.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      this.mesh.add(tile);
      this.feeTileMaterials.push(mat);
    }
  }

  private buildFeeTotems() {
    if (this.checkpoints.length < 4) return;
    const idxs = [
      0,
      Math.floor(this.checkpoints.length * 0.25),
      Math.floor(this.checkpoints.length * 0.5),
      Math.floor(this.checkpoints.length * 0.75),
    ];
    const labels = ['FAST', '30M', '1H', 'MIN'];

    for (let i = 0; i < idxs.length; i++) {
      const cp = this.checkpoints[idxs[i]];
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 24), ringMat);
      ring.position.copy(cp.position);
      ring.position.y += 2.8;
      ring.rotation.x = -Math.PI / 2;
      this.mesh.add(ring);

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85 }),
      );
      sprite.position.copy(cp.position);
      sprite.position.y += 4.1;
      sprite.scale.set(4.4, 1.1, 1);
      this.mesh.add(sprite);

      this.feeTotems.push({ ring, ctx, tex, label: labels[i] });
    }
  }

  private buildLiveBlockHelix() {
    this.blockHelixGroup = new THREE.Group();
    this.blockHelixGroup.position.set(0, 26, 0);
    this.dataSculptures.add(this.blockHelixGroup);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(28, 0.8, 10, 120),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 4;
    this.blockHelixGroup.add(ring);
  }

  private buildMempoolLayeredSlabs() {
    this.mempoolSlabGroup = new THREE.Group();
    this.mempoolSlabGroup.position.set(0, 16, 0);
    this.dataSculptures.add(this.mempoolSlabGroup);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(44, 44, 1.2, 72),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }),
    );
    base.position.y = -0.6;
    this.mempoolSlabGroup.add(base);
  }

  setRecentBlocks(blocks: Array<{ size?: number; tx_count?: number; extras?: { totalFees?: number } }>) {
    if (!blocks || blocks.length === 0 || !this.blockHelixGroup) return;
    const capped = blocks.slice(0, 56);
    const desired = capped.length;

    while (this.helixBlocks.length < desired) {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(4.8, 4.8, 4.8),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0x888888,
          emissiveIntensity: 0.25,
          roughness: 0.5,
          metalness: 0.15,
        }),
      );
      cube.castShadow = true;
      const wire = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 5.5, 5.5),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22 }),
      );
      this.blockHelixGroup.add(cube);
      this.blockHelixGroup.add(wire);
      this.helixBlocks.push({ cube, wire, size: 4.8, targetY: 0, baseY: 0 });
    }
    while (this.helixBlocks.length > desired) {
      const e = this.helixBlocks.pop()!;
      this.blockHelixGroup.remove(e.cube);
      this.blockHelixGroup.remove(e.wire);
    }

    const maxSize = Math.max(1_000_000, ...capped.map(b => b.size ?? 0));
    const maxFees = Math.max(1, ...capped.map(b => b.extras?.totalFees ?? 0));
    const radius = 26;
    const pitch = 2.2;

    for (let i = 0; i < capped.length; i++) {
      const b = capped[i];
      const sizeNorm = THREE.MathUtils.clamp((b.size ?? 0) / maxSize, 0, 1);
      const feeNorm = THREE.MathUtils.clamp((b.extras?.totalFees ?? 0) / maxFees, 0, 1);
      const ang = i * 0.58;
      const x = Math.cos(ang) * radius;
      const z = Math.sin(ang) * radius;
      const y = i * pitch;
      const scale = 2.8 + sizeNorm * 1.8;
      const brightness = 0.45 + feeNorm * 0.55;

      const e = this.helixBlocks[i];
      e.targetY = y;
      e.baseY = y;
      e.size = scale;

      e.cube.position.set(x, y, z);
      e.cube.scale.setScalar(scale);
      e.wire.position.set(x, y, z);
      e.wire.scale.setScalar(scale * 1.1);

      const mat = e.cube.material as THREE.MeshStandardMaterial;
      mat.color.setRGB(brightness, brightness, brightness * 0.95);
      mat.emissive.setRGB(0.2 + feeNorm * 0.7, 0.2 + feeNorm * 0.45, 0.2 + feeNorm * 0.35);
      mat.emissiveIntensity = 0.2 + feeNorm * 0.45;
    }
  }

  setMempoolLayeredSlabs(levels: Array<{ medianFee?: number; blockVSize?: number; nTx?: number }>) {
    if (!levels || levels.length === 0 || !this.mempoolSlabGroup) return;
    const capped = levels.slice(0, 14);
    while (this.mempoolSlabs.length < capped.length) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(28, 2.2, 8.8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
      );
      this.mempoolSlabGroup.add(slab);
      this.mempoolSlabs.push(slab);
    }
    while (this.mempoolSlabs.length > capped.length) {
      const slab = this.mempoolSlabs.pop()!;
      this.mempoolSlabGroup.remove(slab);
    }

    const maxFee = Math.max(25, ...capped.map(l => l.medianFee ?? 0));
    const maxVSize = Math.max(1_000_000, ...capped.map(l => l.blockVSize ?? 0));
    for (let i = 0; i < capped.length; i++) {
      const level = capped[i];
      const feeNorm = THREE.MathUtils.clamp((level.medianFee ?? 0) / maxFee, 0, 1);
      const sizeNorm = THREE.MathUtils.clamp((level.blockVSize ?? 0) / maxVSize, 0, 1);
      const slab = this.mempoolSlabs[i];
      const ang = (i / Math.max(1, capped.length)) * Math.PI * 2 + Math.PI * 0.2;
      const r = 54 + i * 1.8;
      slab.position.set(Math.cos(ang) * r, i * 1.4, Math.sin(ang) * r);
      slab.rotation.y = -ang + Math.PI / 2;
      slab.scale.set(0.7 + sizeNorm * 0.55, 1, 0.7 + feeNorm * 0.45);
      const mat = slab.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(0.35 + feeNorm * 0.65, 0.35 + feeNorm * 0.25, 0.35 - feeNorm * 0.2);
      mat.opacity = 0.24 + feeNorm * 0.42;
    }
  }

  setFeeHeatmap(feeBands: number[]) {
    if (feeBands.length === 0 || this.feeTileMaterials.length === 0) return;
    const maxRef = Math.max(30, ...feeBands);
    const n = this.feeTileMaterials.length;
    for (let i = 0; i < n; i++) {
      const src = feeBands[Math.min(feeBands.length - 1, Math.floor((i / Math.max(1, n - 1)) * feeBands.length))] ?? feeBands[0];
      const h = THREE.MathUtils.clamp(src / maxRef, 0, 1);
      const mat = this.feeTileMaterials[i];
      mat.color.setRGB(0.35 + h * 0.65, 0.35 + h * 0.18, 0.35 - h * 0.2);
      mat.opacity = 0.1 + h * 0.4;
    }
  }

  setMempoolCongestion(level: number) {
    const clamped = THREE.MathUtils.clamp(level, 0, 1);
    const pMat = this.floatingParticles.material as THREE.PointsMaterial;
    pMat.opacity = 0.18 + clamped * 0.34;
    pMat.size = 0.16 + clamped * 0.22;
  }

  setRecommendedFees(fees: {
    fastestFee: number;
    halfHourFee: number;
    hourFee: number;
    minimumFee: number;
  }) {
    if (this.feeTotems.length < 4) return;
    const values = [fees.fastestFee, fees.halfHourFee, fees.hourFee, fees.minimumFee];
    const maxFee = Math.max(20, ...values);
    for (let i = 0; i < this.feeTotems.length; i++) {
      const v = values[i] ?? 0;
      const heat = THREE.MathUtils.clamp(v / maxFee, 0, 1);
      const entry = this.feeTotems[i];
      entry.ring.scale.setScalar(1 + heat * 0.55);
      const ringMat = entry.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.setRGB(0.45 + heat * 0.55, 0.45 + heat * 0.2, 0.45 - heat * 0.2);
      ringMat.opacity = 0.3 + heat * 0.45;

      const ctx = entry.ctx;
      ctx.clearRect(0, 0, 256, 64);
      ctx.fillStyle = 'rgba(10,10,10,0.75)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = 'rgba(230,230,230,0.35)';
      ctx.strokeRect(1, 1, 254, 62);
      ctx.fillStyle = '#f5f5f5';
      ctx.font = 'bold 26px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${entry.label} ${v} sat/vB`, 128, 33);
      entry.tex.needsUpdate = true;
    }
  }

  private buildBlockchainHelices() {
    const startColor = new THREE.Color(0x555555);
    const endColor = new THREE.Color(0xffffff);

    for (let i = 0; i < this.trackPoints.length; i += 20) {
      const pt = this.trackPoints[i];
      if (pt.flags.bridge) continue;
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), pt.direction)
        .normalize();

      for (const side of [-1, 1]) {
        const basePos = pt.position.clone().add(
          right.clone().multiplyScalar(side * (pt.width / 2 + 6)),
        );

        const numDiscs = 6 + Math.floor(Math.random() * 3);
        const helixRadius = 0.6;
        const helixHeight = 0.7;

        for (let d = 0; d < numDiscs; d++) {
          const t = d * 0.5;
          const hx = helixRadius * Math.cos(t);
          const hy = helixHeight * d;
          const hz = helixRadius * Math.sin(t);

          const progress = d / (numDiscs - 1);
          const color = new THREE.Color().lerpColors(startColor, endColor, progress);
          const discRadius = 0.4 + Math.random() * 0.2;

          const discGeom = new THREE.CylinderGeometry(discRadius, discRadius, 0.05, 16);
          const discMat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.8,
            metalness: 0.0,
          });
          const disc = new THREE.Mesh(discGeom, discMat);
          disc.position.set(basePos.x + hx, basePos.y + hy + 0.5, basePos.z + hz);
          disc.rotation.set(Math.PI / 2, 0, t);
          disc.castShadow = true;
          this.mesh.add(disc);
        }
      }
    }
  }

  private buildNetworkNodes() {
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
    });

    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 60 + Math.random() * 100;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 5 + Math.random() * 25;

      const size = 0.5 + Math.random() * 1.5;
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), nodeMat);
      sphere.position.set(x, y, z);
      this.mesh.add(sphere);
    }
  }

  private buildFloatingParticles() {
    const particleCount = 500;
    const pGeom = new THREE.BufferGeometry();
    const pPositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      pPositions[i * 3] = (Math.random() - 0.5) * 400;
      pPositions[i * 3 + 1] = Math.random() * 50 + 2;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 400;
    }
    pGeom.setAttribute('position', new THREE.Float32BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.2,
      transparent: true,
      opacity: 0.3,
    });
    this.floatingParticles = new THREE.Points(pGeom, pMat);
    this.mesh.add(this.floatingParticles);
  }

  updateParticles(dt: number) {
    if (!this.floatingParticles) return;
    const pos = this.floatingParticles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i);
      y += dt * 0.5;
      if (y > 52) y = 2;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    const t = performance.now() * 0.001;
    if (this.blockHelixGroup) {
      this.blockHelixGroup.rotation.y += dt * 0.24;
      for (let i = 0; i < this.helixBlocks.length; i++) {
        const e = this.helixBlocks[i];
        const bob = Math.sin(t * 1.6 + i * 0.33) * 0.045;
        e.cube.position.y = e.baseY + bob;
        e.wire.position.y = e.baseY + bob;
      }
    }
    if (this.mempoolSlabGroup) {
      this.mempoolSlabGroup.rotation.y = t * 0.15;
      for (let i = 0; i < this.mempoolSlabs.length; i++) {
        const slab = this.mempoolSlabs[i];
        slab.position.y += Math.sin(t * 1.2 + i * 0.4) * 0.0018;
      }
    }

    for (let i = 0; i < this.beaconLights.length; i++) {
      const pulse = 0.6 + Math.sin(t * 1.6 + i * 0.55) * 0.35;
      this.beaconLights[i].intensity = 0.35 + pulse * 0.9;
    }
    for (let i = 0; i < this.beaconHalos.length; i++) {
      this.beaconHalos[i].rotation.z += dt * (0.2 + i * 0.015);
      const mat = this.beaconHalos[i].material as THREE.MeshBasicMaterial;
      mat.opacity = 0.1 + (Math.sin(t * 1.9 + i * 0.7) * 0.5 + 0.5) * 0.12;
    }
    for (let i = 0; i < this.beaconBeams.length; i++) {
      const pulse = 0.5 + (Math.sin(t * 1.35 + i * 0.8) * 0.5 + 0.5) * 0.5;
      const beamMat = this.beaconBeams[i].material as THREE.MeshBasicMaterial;
      beamMat.opacity = 0.12 + pulse * 0.16;
      this.beaconBeams[i].scale.setScalar(0.94 + pulse * 0.12);
    }
    for (let i = 0; i < this.beaconFlares.length; i++) {
      const pulse = Math.sin(t * 2.1 + i * 0.6) * 0.5 + 0.5;
      const flare = this.beaconFlares[i];
      const flareMat = flare.material as THREE.SpriteMaterial;
      flareMat.opacity = 0.45 + pulse * 0.35;
      const s = 13 + pulse * 7;
      flare.scale.set(s, s, 1);
    }
  }

  // ─── CHECKPOINT CHECK ──────────────────────────────────────────

  checkCheckpoint(kartPosition: THREE.Vector3, kartLastCheckpoint: number): number {
    const nextCheckpoint = (kartLastCheckpoint + 1) % this.checkpoints.length;
    const cp = this.checkpoints[nextCheckpoint];
    const flatKart = new THREE.Vector3(kartPosition.x, 0, kartPosition.z);
    const flatCp = new THREE.Vector3(cp.position.x, 0, cp.position.z);
    const dist = flatKart.distanceTo(flatCp);
    if (dist < cp.width * 0.85) {
      return nextCheckpoint;
    }
    return kartLastCheckpoint;
  }

  // ─── RAMP DETECTION ────────────────────────────────────────────

  isOnRamp(pos: THREE.Vector3): boolean {
    const info = this.getTrackInfo(pos);
    return !!info.flags.ramp;
  }
}
