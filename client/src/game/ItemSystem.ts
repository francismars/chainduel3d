import * as THREE from 'three';
import { ChainRider } from './ChainRider';
import { ItemId, ITEMS, OnlineItemBoxState, OnlineObstacleState } from 'shared/types';

interface ItemBox {
  mesh: THREE.Group;
  position: THREE.Vector3;
  active: boolean;
  respawnTimer: number;
  ring: THREE.Mesh;
  sprite: THREE.Sprite;
  spriteCtx: CanvasRenderingContext2D;
  spriteTex: THREE.CanvasTexture;
  previewItem: ItemId;
  previewTimer: number;
  previewFlashTimer: number;
}

interface ForkBombObstacle {
  mesh: THREE.Mesh;
  body: THREE.Vector3;
  lifetime: number;
}

export class ItemSystem {
  private itemBoxes: ItemBox[] = [];
  private obstacles: ForkBombObstacle[] = [];
  private scene: THREE.Scene;
  private itemPool: ItemId[] = ['ln_turbo', 'mempool_mine', 'fee_spike', 'sats_siphon', 'nostr_zap'];

  public playerItems: (string | null)[];
  private finalLapIntensity = false;
  private localAuthorityEnabled = true;

  constructor(scene: THREE.Scene, positions: THREE.Vector3[], playerCount = 4) {
    this.scene = scene;
    this.playerItems = new Array(Math.max(1, playerCount | 0)).fill(null);

    for (const pos of positions) {
      const group = new THREE.Group();
      group.position.copy(pos);

      const outerGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
      const outerMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        wireframe: true,
      });
      group.add(new THREE.Mesh(outerGeom, outerMat));

      const innerMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x888888,
        emissiveIntensity: 0.6,
      });
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), innerMat));

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(0.6, 0.6, 0.6);
      group.add(sprite);

      const ringGeom = new THREE.RingGeometry(0.8, 0.9, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      group.add(ring);

      scene.add(group);
      const previewItem = this.rollPreviewItem();
      const box: ItemBox = {
        mesh: group,
        position: pos.clone(),
        active: true,
        respawnTimer: 0,
        ring,
        sprite,
        spriteCtx: ctx,
        spriteTex: tex,
        previewItem,
        previewTimer: 0,
        previewFlashTimer: 0.35,
      };
      this.paintPreviewIcon(box, previewItem);
      this.itemBoxes.push(box);
    }
  }

  update(dt: number, karts: ChainRider[], positions: number[]) {
    this.updateVisuals(dt);
    if (this.localAuthorityEnabled) {
      this.updateAuthoritativeLocalState(dt, karts, positions);
    }
  }

  updateOnlineVisuals(dt: number) {
    this.updateVisuals(dt);
  }

  private updateVisuals(dt: number) {
    const time = performance.now() / 1000;

    for (const box of this.itemBoxes) {
      if (box.active) {
        box.previewFlashTimer = Math.max(0, box.previewFlashTimer - dt);
        box.mesh.rotation.y = time * 2;
        box.mesh.position.y = box.position.y + Math.sin(time * 3) * 0.3;

        // Pulse scale
        const pulse = 1 + Math.sin(time * 4) * 0.08;
        box.mesh.scale.set(pulse, pulse, pulse);

        // Orbiting ring
        box.ring.rotation.x = time * 1.5;
        box.ring.rotation.z = time * 0.8;
        const ringMat = box.ring.material as THREE.MeshBasicMaterial;
        const flash = box.previewFlashTimer > 0 ? box.previewFlashTimer / 0.35 : 0;
        ringMat.opacity = 0.2 + flash * 0.55;
        box.sprite.scale.setScalar(0.6 + flash * 0.16);
        box.mesh.visible = true;
      } else {
        box.mesh.visible = false;
      }
    }

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.lifetime -= dt;
      obs.mesh.rotation.y += dt * 3;

      // Pulsing emissive glow
      const mat = obs.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.5 + Math.sin(time * 6) * 0.4;

      if (obs.lifetime <= 0) {
        this.scene.remove(obs.mesh);
        this.obstacles.splice(i, 1);
        continue;
      }

    }
  }

  private updateAuthoritativeLocalState(dt: number, karts: ChainRider[], positions: number[]) {
    for (const box of this.itemBoxes) {
      if (box.active) {
        box.previewTimer -= dt;
        if (box.previewTimer <= 0) {
          box.previewItem = this.rollPreviewItem();
          this.paintPreviewIcon(box, box.previewItem);
          box.previewFlashTimer = 0.35;
          box.previewTimer = this.finalLapIntensity ? 1.1 : 2.2;
        }

        for (let i = 0; i < karts.length; i++) {
          if (this.playerItems[i] !== null) continue;
          const dist = karts[i].getPosition().distanceTo(box.position);
          if (dist < 2.5) {
            this.collectItem(i, box, karts, positions);
          }
        }
      } else {
        box.respawnTimer -= dt;
        if (box.respawnTimer <= 0) {
          box.active = true;
          box.previewItem = this.rollPreviewItem();
          this.paintPreviewIcon(box, box.previewItem);
          box.previewFlashTimer = 0.35;
          box.previewTimer = this.finalLapIntensity ? 0.9 : 1.8;
        }
      }
    }

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      for (const kart of karts) {
        const dist = kart.getPosition().distanceTo(obs.body);
        if (dist < 2.0) {
          kart.speed *= 0.3;
          kart.heading += Math.PI * 0.25;
          this.scene.remove(obs.mesh);
          this.obstacles.splice(i, 1);
          break;
        }
      }
    }
  }

  private collectItem(playerIndex: number, box: ItemBox, karts: ChainRider[], positions: number[]) {
    void karts;
    void positions;
    this.playerItems[playerIndex] = box.previewItem;
    box.active = false;
    box.respawnTimer = this.finalLapIntensity ? 3.5 : 5;
  }

  private rollPreviewItem(): ItemId {
    // Slightly favor utility tools over pure speed for better race reads.
    const weights: Array<[ItemId, number]> = [
      ['ln_turbo', 0.24],
      ['mempool_mine', 0.18],
      ['fee_spike', 0.24],
      ['sats_siphon', 0.20],
      ['nostr_zap', 0.14],
    ];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [id, w] of weights) {
      r -= w;
      if (r <= 0) return id;
    }
    return 'ln_turbo';
  }

  private paintPreviewIcon(box: ItemBox, itemId: ItemId) {
    const ctx = box.spriteCtx;
    const icon = this.itemIcon(ITEMS[itemId]?.name ?? '');
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, 32, 32);
    box.spriteTex.needsUpdate = true;
  }

  private itemIcon(name: string): string {
    if (name.includes('Lightning')) return '⚡';
    if (name.includes('Mempool')) return '⛏';
    if (name.includes('Fee')) return '₿';
    if (name.includes('Siphon')) return 'ₛ';
    if (name.includes('Nostr')) return '✶';
    return '?';
  }

  useItem(playerIndex: number, karts: ChainRider[]): boolean {
    if (!this.localAuthorityEnabled) return false;
    const item = this.playerItems[playerIndex];
    if (!item) return false;

    const user = karts[playerIndex];
    const opponents = karts.filter((_, i) => i !== playerIndex);

    switch (item) {
      case 'ln_turbo':
        user.activateSpeedBoost((ITEMS.ln_turbo.duration ?? 2200) * (this.finalLapIntensity ? 1.2 : 1));
        this.spawnBoostEffect(user);
        break;

      case 'mempool_mine':
        this.spawnForkBomb(user);
        break;

      case 'fee_spike': {
        // Hit the nearest opponent
        let nearest = opponents[0];
        let bestDist = Infinity;
        const userPos = user.getPosition();
        for (const opp of opponents) {
          const d = userPos.distanceTo(opp.getPosition());
          if (d < bestDist) { bestDist = d; nearest = opp; }
        }
        nearest.activateSlow((ITEMS.fee_spike.duration ?? 2400) * (this.finalLapIntensity ? 1.25 : 1));
        this.spawnLightningEffect(nearest);
        break;
      }
      case 'sats_siphon': {
        let nearest: ChainRider | null = null;
        let bestDist = Infinity;
        const userPos = user.getPosition();
        for (const opp of opponents) {
          if (opp.isEliminated() || opp.getChainLength() <= 1) continue;
          const d = userPos.distanceTo(opp.getPosition());
          if (d < bestDist) {
            bestDist = d;
            nearest = opp;
          }
        }
        if (nearest && nearest.loseBlock()) {
          user.gainBlock();
          nearest.applyStealPenalty();
          user.applyStealReward();
          this.spawnLightningEffect(nearest);
        }
        break;
      }
      case 'nostr_zap': {
        const userPos = user.getPosition();
        let hitCount = 0;
        for (const opp of opponents) {
          if (opp.isEliminated()) continue;
          const d = userPos.distanceTo(opp.getPosition());
          if (d <= 18) {
            opp.activateSlow((ITEMS.nostr_zap.duration ?? 1600) * (this.finalLapIntensity ? 1.3 : 1));
            this.spawnLightningEffect(opp);
            hitCount++;
          }
        }
        if (hitCount === 0) {
          user.activateSpeedBoost(500);
        }
        break;
      }
    }

    this.playerItems[playerIndex] = null;
    return true;
  }

  playOnlineItemEffect(
    item: ItemId,
    playerIndex: number,
    targetPlayerIndex: number | undefined,
    karts: ChainRider[],
  ) {
    const user = karts[playerIndex];
    if (!user) return;
    if (item === 'ln_turbo') {
      this.spawnBoostEffect(user);
      return;
    }
    if (item === 'mempool_mine') {
      // Persistent online mine visuals are driven by authoritative obstacle snapshots.
      return;
    }
    if (item === 'fee_spike' || item === 'sats_siphon') {
      if (targetPlayerIndex == null) return;
      const target = karts[targetPlayerIndex];
      if (target) this.spawnLightningEffect(target);
      return;
    }
    if (item === 'nostr_zap') {
      if (targetPlayerIndex != null) {
        const target = karts[targetPlayerIndex];
        if (target) this.spawnLightningEffect(target);
      }
      return;
    }
  }

  private spawnBoostEffect(kart: ChainRider) {
    const flames = new THREE.Group();
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2, 8), coneMat);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = -2;
    flames.add(cone);

    const sparkGeom = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(30 * 3);
    for (let i = 0; i < 30; i++) {
      sparkPositions[i * 3] = (Math.random() - 0.5) * 1.5;
      sparkPositions[i * 3 + 1] = Math.random() * 0.5;
      sparkPositions[i * 3 + 2] = -1.5 - Math.random() * 2;
    }
    sparkGeom.setAttribute('position', new THREE.Float32BufferAttribute(sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.12,
      transparent: true,
      opacity: 0.5,
    });
    flames.add(new THREE.Points(sparkGeom, sparkMat));

    kart.mesh.add(flames);
    setTimeout(() => kart.mesh.remove(flames), 800);
  }

  private spawnForkBomb(kart: ChainRider) {
    const pos = kart.getPosition().clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(kart.getQuaternion());
    pos.add(dir.multiplyScalar(-3));
    pos.y = 0.5;

    const geom = new THREE.OctahedronGeometry(0.6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x444444,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.2,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    this.obstacles.push({ mesh, body: pos.clone(), lifetime: 15 });
  }

  private spawnLightningEffect(kart: ChainRider) {
    const kartPos = kart.getPosition();

    // Lightning bolt geometry (jagged line from sky to kart)
    const boltGeom = new THREE.BufferGeometry();
    const boltPts: number[] = [];
    let bx = kartPos.x, bz = kartPos.z;
    const segments = 8;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const y = kartPos.y + (1 - t) * 20;
      boltPts.push(bx, y, bz);
      bx += (Math.random() - 0.5) * 3;
      bz += (Math.random() - 0.5) * 3;
    }
    boltGeom.setAttribute('position', new THREE.Float32BufferAttribute(boltPts, 3));
    const boltMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 2,
    });
    const bolt = new THREE.Line(boltGeom, boltMat);
    this.scene.add(bolt);

    const flash = new THREE.PointLight(0xffffff, 8, 30);
    flash.position.copy(kartPos);
    flash.position.y += 3;
    this.scene.add(flash);

    setTimeout(() => {
      this.scene.remove(bolt);
      this.scene.remove(flash);
    }, 300);
  }

  getItemName(playerIndex: number): string | null {
    const item = this.playerItems[playerIndex];
    if (!item) return null;
    return ITEMS[item]?.name ?? null;
  }

  setFinalLapIntensity(active: boolean) {
    this.finalLapIntensity = active;
  }

  setLocalAuthorityEnabled(enabled: boolean) {
    this.localAuthorityEnabled = enabled;
  }

  applyOnlineItemBoxes(serverBoxes: OnlineItemBoxState[] | undefined) {
    if (!serverBoxes) return;
    for (let i = 0; i < this.itemBoxes.length; i++) {
      const local = this.itemBoxes[i];
      const remote = serverBoxes[i];
      if (!remote) {
        local.active = false;
        local.mesh.visible = false;
        continue;
      }
      local.position.set(remote.x, remote.y, remote.z);
      local.mesh.position.copy(local.position);
      local.active = remote.active;
      local.mesh.visible = remote.active;
      if (local.previewItem !== remote.previewItem) {
        local.previewItem = remote.previewItem;
        this.paintPreviewIcon(local, remote.previewItem);
        local.previewFlashTimer = 0.35;
      }
    }
  }

  applyOnlineObstacles(serverObstacles: OnlineObstacleState[] | undefined) {
    const next = serverObstacles ?? [];
    while (this.obstacles.length > next.length) {
      const removed = this.obstacles.pop();
      if (removed) this.scene.remove(removed.mesh);
    }
    while (this.obstacles.length < next.length) {
      const geom = new THREE.OctahedronGeometry(0.6);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x444444,
        emissiveIntensity: 0.5,
        roughness: 0.4,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geom, mat);
      this.scene.add(mesh);
      this.obstacles.push({ mesh, body: new THREE.Vector3(), lifetime: 999 });
    }
    for (let i = 0; i < next.length; i++) {
      const remote = next[i];
      const local = this.obstacles[i];
      local.body.set(remote.x, remote.y, remote.z);
      local.mesh.position.copy(local.body);
      local.lifetime = Math.max(0.1, remote.lifetimeMs / 1000);
      local.mesh.visible = remote.lifetimeMs > 0;
    }
  }

  dispose() {
    for (const box of this.itemBoxes) {
      this.scene.remove(box.mesh);
    }
    for (const obs of this.obstacles) {
      this.scene.remove(obs.mesh);
    }
  }
}
