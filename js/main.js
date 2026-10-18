/**
 * 架空城市地铁建设沙盒 — 入口
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createWorldGroup,
  setupLights,
  createDemandGrid,
  animateWorld,
  WORLD_SIZE,
} from './world.js';
import { MetroNetwork, METHODS, SNAP_RADIUS, ERASE_RADIUS, STATION_RADIUS } from './metro.js';
import { PassengerSim } from './passenger.js';
import { UI } from './ui.js';
import { FeedbackFX } from './feedback.js';
import { saveGame, loadGame, applyDemand, hasSave } from './save.js';

class Game {
  constructor() {
    this.tool = 'select';
    this.method = 'elevated';
    this.snapNodes = true;
    this.gridSnap = false;
    this.topDown = false;
    this.autoTopDownBuild = true;
    this._savedCamera = null;

    this.wrap = document.getElementById('canvas-wrap');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.wrap.clientWidth, this.wrap.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.wrap.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x081428);
    this.scene.fog = new THREE.FogExp2(0x0a1830, 0.0065);

    this.camera = new THREE.PerspectiveCamera(
      48,
      this.wrap.clientWidth / this.wrap.clientHeight,
      0.1,
      400
    );
    this.camera.position.set(45, 55, 55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 150;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
    this.controls.screenSpacePanning = true;

    setupLights(this.scene);
    createWorldGroup(this.scene);

    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._pointerDownPos = null;
    this._dragging = false;

    this.demandGrid = createDemandGrid(20);
    this.network = new MetroNetwork(this.scene);
    this.passenger = new PassengerSim(this.network, this.demandGrid);

    this.network.createLine('#3aa0ff');

    this.ui = new UI(this);
    this.feedback = new FeedbackFX(this.network, this.passenger, this.ui);
    this.ui.refreshLineList();
    this.ui.refreshStats();

    this._bindPointer();
    window.addEventListener('resize', () => this.onResize());

    this.clock = new THREE.Clock();
    this.animate();

    this.ui.toast('欢迎！新建线路后选择「铺轨」· Z 撤销上点 · Esc 结束折线');
  }

  setTool(tool) {
    const prev = this.tool;
    this.tool = tool;
    this.network.cancelPending();
    this.ui.hidePreview();

    const building = tool === 'track' || tool === 'station' || tool === 'erase';
    if (building) {
      // Left click places — do not pan/orbit with left
      this.controls.mouseButtons.LEFT = null;
      this.controls.enableRotate = true;
      if (tool === 'track') {
        // Softer orbit while placing so right-drag still works but fights less
        this.controls.rotateSpeed = 0.4;
        this.controls.panSpeed = 0.75;
      } else {
        this.controls.rotateSpeed = 0.85;
        this.controls.panSpeed = 0.9;
      }
    } else {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      this.controls.enableRotate = true;
      this.controls.rotateSpeed = 1;
      this.controls.panSpeed = 1;
    }

    // Auto top-down when entering track
    if (tool === 'track' && this.autoTopDownBuild && !this.topDown) {
      this._enterBuildCamera();
    } else if (prev === 'track' && tool !== 'track' && this._buildCamActive) {
      this._exitBuildCamera();
    }

    this.ui.updateBuildHints?.();
  }

  _enterBuildCamera() {
    this._savedCamera = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      maxPolar: this.controls.maxPolarAngle,
    };
    this._buildCamActive = true;
    this.camera.position.set(
      this.controls.target.x,
      95,
      this.controls.target.z + 0.01
    );
    this.controls.maxPolarAngle = 0.02;
    this.controls.update();
    const btn = document.getElementById('btn-topdown');
    if (btn) btn.classList.add('active-cam');
  }

  _exitBuildCamera() {
    this._buildCamActive = false;
    if (this._savedCamera && !this.topDown) {
      this.camera.position.copy(this._savedCamera.pos);
      this.controls.target.copy(this._savedCamera.target);
      this.controls.maxPolarAngle = this._savedCamera.maxPolar;
      this.controls.update();
    }
    this._savedCamera = null;
    const btn = document.getElementById('btn-topdown');
    if (btn && !this.topDown) btn.classList.remove('active-cam');
  }

  newLine(color) {
    const line = this.network.createLine(color);
    this.network.cancelPending();
    this.ui.refreshLineList();
    this.ui.toast(`已创建 ${line.name}`);
  }

  selectLine(id) {
    this.network.setActiveLine(id);
    this.ui.refreshLineList();
  }

  setActiveLineColor(color) {
    const line = this.network.getActiveLine();
    if (!line) return;
    this.network.setLineColor(line.id, color);
    this.ui.refreshLineList();
  }

  setFrequency(lineId, freq) {
    this.network.setFrequency(lineId, freq);
    this.ui.refreshLineList();
    this.passenger.simulate();
    this.ui.refreshStats();
  }

  togglePeak() {
    this.passenger.setPeak(!this.passenger.peak);
    this.passenger.simulate();
    this.ui.refreshStats();
  }

  toggleSim() {
    this.passenger.setEnabled(!this.passenger.enabled);
  }

  toggleTopDown() {
    this.topDown = !this.topDown;
    if (this.topDown) {
      if (!this._savedCamera) {
        this._savedCamera = {
          pos: this.camera.position.clone(),
          target: this.controls.target.clone(),
          maxPolar: this.controls.maxPolarAngle,
        };
      }
      this.camera.position.set(this.controls.target.x, 100, this.controls.target.z + 0.01);
      this.controls.maxPolarAngle = 0.01;
      document.getElementById('btn-topdown')?.classList.add('active-cam');
    } else {
      this.controls.maxPolarAngle = Math.PI * 0.48;
      if (this._savedCamera && !this._buildCamActive) {
        this.camera.position.copy(this._savedCamera.pos);
        this.controls.target.copy(this._savedCamera.target);
        this._savedCamera = null;
      } else if (!this._buildCamActive) {
        this.camera.position.set(45, 55, 55);
        this.controls.target.set(0, 0, 0);
      }
      if (!this._buildCamActive) {
        document.getElementById('btn-topdown')?.classList.remove('active-cam');
      }
    }
    this.controls.update();
  }

  undoTrack() {
    const r = this.network.undoLastNode();
    if (!r.success) {
      this.ui.toast(r.reason || '无法撤销');
      return;
    }
    this.ui.toast('已撤销上一点');
    this.passenger.simulate();
    this.ui.refreshStats();
  }

  save() {
    const at = saveGame(this.network, this.demandGrid, { tool: this.tool });
    this.ui.toast(`已存档 ${new Date(at).toLocaleString('zh-CN')}`);
  }

  load() {
    const data = loadGame();
    if (!data) {
      this.ui.toast('没有找到本地存档');
      return;
    }
    this.network.fromJSON(data.network);
    applyDemand(this.demandGrid, data);
    this.ui.refreshLineList();
    this.passenger.simulate();
    this.ui.refreshStats();
    this.ui.toast('存档已读入');
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _getGroundHit(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!ok) return null;
    return hit;
  }

  onPointerMove(event) {
    if (this._pointerDownPos) {
      const dx = event.clientX - this._pointerDownPos.x;
      const dy = event.clientY - this._pointerDownPos.y;
      if (dx * dx + dy * dy > 36) this._dragging = true;
    }

    if (this.tool !== 'track') {
      this.network.clearGhost();
      if (this.tool !== 'station') this.ui.hidePreview();
      return;
    }
    const hit = this._getGroundHit(event);
    if (!hit) return;
    const ev = this.network.updateGhost(
      hit.x,
      hit.z,
      this.method,
      this.snapNodes,
      this.gridSnap
    );
    if (ev) this.ui.showPreview(ev, this.method);
    else if (this.network.pendingPath.length === 0) this.ui.hidePreview();
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    this._pointerDownPos = { x: event.clientX, y: event.clientY };
    this._dragging = false;
  }

  onPointerUp(event) {
    if (event.button !== 0) return;
    const wasDragging = this._dragging;
    this._pointerDownPos = null;
    this._dragging = false;
    if (wasDragging) return; // click-only place — avoid fighting pan
    if (this.tool === 'select') return;

    const hit = this._getGroundHit(event);
    if (!hit) return;

    if (this.tool === 'track') {
      const result = this.network.placeTrackPoint(
        hit.x,
        hit.z,
        this.method,
        this.snapNodes,
        this.gridSnap
      );
      if (!result.success) {
        this.ui.toast(result.reason || '无法铺轨');
        if (result.eval) this.ui.showPreview(result.eval, this.method);
        return;
      }
      if (result.eval) this.ui.showPreview(result.eval, this.method);
      if (result.started) {
        this.ui.toast(
          result.snapped
            ? '已吸附起点 · 继续点击延伸 · Z 撤销 · Esc 结束'
            : '已落起点 · 继续点击延伸 · Z 撤销 · Esc 结束'
        );
      } else if (result.eval) {
        const snapNote = result.snapped ? '（吸附）' : '';
        this.ui.toast(`已铺设${snapNote} · 耗时 ${result.eval.time} / 难度 ${result.eval.difficulty}`);
      }
      this.ui.refreshStats();
      return;
    }

    if (this.tool === 'station') {
      let node = this.network.findNearbyNode(hit.x, hit.z, STATION_RADIUS);
      if (!node) {
        this.ui.toast('请靠近已有轨道节点设站（吸附范围已加大）');
        return;
      }
      this.network.makeStation(node.id);
      this.ui.toast('已设站');
      this.passenger.simulate();
      this.ui.refreshStats();
      return;
    }

    if (this.tool === 'erase') {
      const ok = this.network.eraseNear(hit.x, hit.z, ERASE_RADIUS);
      this.ui.toast(ok ? '已删除节点及相连轨道' : '附近没有节点');
      this.passenger.simulate();
      this.ui.refreshStats();
      this.ui.refreshLineList();
    }
  }

  onResize() {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    this.controls.update();
    animateWorld(this.scene, t);
    this.passenger.update(dt);
    this.feedback.update(dt, t);
    this.ui.refreshStats();
    this.ui.drawMinimap();
    this.ui.updateRidershipChart?.();
    this.renderer.render(this.scene, this.camera);
  }
}

const game = new Game();
window.__metroGame = game;
window.__METHODS = METHODS;
