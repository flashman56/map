/**
 * 架空城市地铁建设沙盒 — 入口
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createWorldGroup,
  setupLights,
  createDemandGrid,
  WORLD_SIZE,
} from './world.js';
import { MetroNetwork, METHODS } from './metro.js';
import { PassengerSim } from './passenger.js';
import { UI } from './ui.js';
import { saveGame, loadGame, applyDemand, hasSave } from './save.js';

class Game {
  constructor() {
    this.tool = 'select';
    this.method = 'elevated';
    this.snapNodes = true;
    this.topDown = false;

    this.wrap = document.getElementById('canvas-wrap');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.wrap.clientWidth, this.wrap.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.wrap.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1528);
    this.scene.fog = new THREE.Fog(0x0a1528, 90, 180);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.wrap.clientWidth / this.wrap.clientHeight,
      0.1,
      400
    );
    this.camera.position.set(45, 55, 55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 140;
    this.controls.target.set(0, 0, 0);
    // 右键旋转、中键平移（Three 默认左键旋转——改为：左键用于建造时不转）
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };

    setupLights(this.scene);
    createWorldGroup(this.scene);

    // 点击平面
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.demandGrid = createDemandGrid(20);
    this.network = new MetroNetwork(this.scene);
    this.passenger = new PassengerSim(this.network, this.demandGrid);

    // 默认一条线
    this.network.createLine('#3aa0ff');

    this.ui = new UI(this);
    this.ui.refreshLineList();
    this.ui.refreshStats();

    this._bindPointer();
    window.addEventListener('resize', () => this.onResize());

    this.clock = new THREE.Clock();
    this.animate();

    this.ui.toast('欢迎！新建线路后选择「铺轨」开始建设');
  }

  setTool(tool) {
    this.tool = tool;
    this.network.cancelPending();
    this.ui.hidePreview();
    // 铺轨时左键不平移
    if (tool === 'track' || tool === 'station' || tool === 'erase') {
      this.controls.mouseButtons.LEFT = null;
    } else {
      this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    }
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
      this.camera.position.set(0, 100, 0.01);
      this.controls.target.set(0, 0, 0);
      this.controls.maxPolarAngle = 0.01;
    } else {
      this.controls.maxPolarAngle = Math.PI * 0.48;
      this.camera.position.set(45, 55, 55);
    }
    this.controls.update();
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
    if (this.tool !== 'track') {
      this.network.clearGhost();
      if (this.tool !== 'station') this.ui.hidePreview();
      return;
    }
    const hit = this._getGroundHit(event);
    if (!hit) return;
    let x = hit.x;
    let z = hit.z;
    if (this.snapNodes) {
      const near = this.network.findNearbyNode(x, z, 2.8);
      if (near) {
        x = near.x;
        z = near.z;
      }
    }
    const ev = this.network.updateGhost(x, z, this.method);
    if (ev) this.ui.showPreview(ev, this.method);
    else if (this.network.pendingPath.length === 0) this.ui.hidePreview();
  }

  onPointerDown(event) {
    if (event.button !== 0) return; // 仅左键建造
    if (this.tool === 'select') return;

    const hit = this._getGroundHit(event);
    if (!hit) return;
    let x = hit.x;
    let z = hit.z;

    if (this.tool === 'track') {
      const result = this.network.placeTrackPoint(x, z, this.method, this.snapNodes);
      if (!result.success) {
        this.ui.toast(result.reason || '无法铺轨');
        if (result.eval) this.ui.showPreview(result.eval, this.method);
        return;
      }
      if (result.eval) this.ui.showPreview(result.eval, this.method);
      if (result.started) this.ui.toast('已落起点，继续点击延伸；Esc 结束');
      else if (result.eval) {
        this.ui.toast(`已铺设 · 耗时 ${result.eval.time} / 难度 ${result.eval.difficulty}`);
      }
      this.ui.refreshStats();
      return;
    }

    if (this.tool === 'station') {
      let node = this.network.findNearbyNode(x, z, 3.5);
      if (!node) {
        // 若靠近某段轨道中点也可设站——简化：必须靠近节点
        this.ui.toast('请靠近已有轨道节点设站');
        return;
      }
      this.network.makeStation(node.id);
      this.ui.toast('已设站');
      this.passenger.simulate();
      this.ui.refreshStats();
      return;
    }

    if (this.tool === 'erase') {
      const ok = this.network.eraseNear(x, z, 3);
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
    this.controls.update();
    this.passenger.update(dt);
    this.ui.refreshStats();
    this.ui.drawMinimap();
    this.renderer.render(this.scene, this.camera);
  }
}

// boot
const game = new Game();
window.__metroGame = game;

// 暴露 METHODS 供调试
window.__METHODS = METHODS;
