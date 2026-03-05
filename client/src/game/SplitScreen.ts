import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export class SplitScreen {
  public renderer: THREE.WebGLRenderer;
  public cameras: THREE.PerspectiveCamera[];
  private width: number;
  private height: number;
  private activePlayers: number[] = [0, 1, 2, 3];
  private readonly maxPlayers: number;

  private renderTargets: THREE.WebGLRenderTarget[];
  private postScene: THREE.Scene;
  private postCamera: THREE.OrthographicCamera;
  private composer: EffectComposer;
  private quads: THREE.Mesh[] = [];

  constructor(container: HTMLElement, maxPlayers = 8) {
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    this.maxPlayers = Math.max(1, maxPlayers | 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const aspect = this.width / this.height;

    this.cameras = [];
    this.renderTargets = [];
    for (let i = 0; i < this.maxPlayers; i++) {
      this.cameras.push(new THREE.PerspectiveCamera(75, aspect, 0.1, 500));
      this.renderTargets.push(new THREE.WebGLRenderTarget(Math.max(1, this.width), Math.max(1, this.height)));
    }

    // 2x2 grid of quads for post-processing
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    for (let i = 0; i < 4; i++) {
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.renderTargets[i].texture }),
      );
      this.postScene.add(quad);
      this.quads.push(quad);
    }

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.postScene, this.postCamera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.6,
      0.4,
      0.85,
    ));
    this.composer.addPass(new OutputPass());

    this.updateLayout();
    window.addEventListener('resize', () => this.onResize(container));
  }

  private onResize(container: HTMLElement) {
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    this.renderer.setSize(this.width, this.height);

    this.updateLayout();
    this.composer.setSize(this.width, this.height);
  }

  setActivePlayers(players: number[]) {
    const unique = Array.from(new Set(players.filter(p => p >= 0 && p < this.maxPlayers)));
    this.activePlayers = unique.length > 0 ? unique : [0];
    this.updateLayout();
  }

  private updateLayout() {
    const n = this.activePlayers.length;
    const slots = this.getSlots(n);
    for (let panel = 0; panel < 4; panel++) {
      const quad = this.quads[panel];
      const slot = slots[panel];
      if (!slot) {
        quad.visible = false;
        continue;
      }
      quad.visible = true;
      quad.position.set(slot.x, slot.y, 0);
      quad.scale.set(slot.w, slot.h, 1);

      const playerIndex = this.activePlayers[panel];
      const mat = quad.material as THREE.MeshBasicMaterial;
      mat.map = this.renderTargets[playerIndex].texture;
      mat.needsUpdate = true;

      const pixelW = Math.max(1, Math.floor(this.width * (slot.w / 2)));
      const pixelH = Math.max(1, Math.floor(this.height * (slot.h / 2)));
      this.renderTargets[playerIndex].setSize(pixelW, pixelH);
      this.cameras[playerIndex].aspect = pixelW / pixelH;
      this.cameras[playerIndex].updateProjectionMatrix();
    }
  }

  private getSlots(count: number): Array<{ x: number; y: number; w: number; h: number }> {
    if (count <= 1) return [{ x: 0, y: 0, w: 2, h: 2 }];
    if (count === 2) {
      return [
        { x: -0.5, y: 0, w: 1, h: 2 },
        { x: 0.5, y: 0, w: 1, h: 2 },
      ];
    }
    if (count === 3) {
      return [
        { x: 0, y: 0.5, w: 2, h: 1 },
        { x: -0.5, y: -0.5, w: 1, h: 1 },
        { x: 0.5, y: -0.5, w: 1, h: 1 },
      ];
    }
    return [
      { x: -0.5, y: 0.5, w: 1, h: 1 },
      { x: 0.5, y: 0.5, w: 1, h: 1 },
      { x: -0.5, y: -0.5, w: 1, h: 1 },
      { x: 0.5, y: -0.5, w: 1, h: 1 },
    ];
  }

  render(scene: THREE.Scene) {
    for (const i of this.activePlayers) {
      this.renderer.setRenderTarget(this.renderTargets[i]);
      this.renderer.clear();
      this.renderer.render(scene, this.cameras[i]);
    }

    this.renderer.setRenderTarget(null);
    this.composer.render();
  }

  dispose() {
    for (const rt of this.renderTargets) rt.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
