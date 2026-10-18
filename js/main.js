/**
 * 架空城市地铁建设沙盒 — 2D 俯视入口（Canvas2D）
 */
import {
  bakeCityBase,
  createDemandGrid,
  worldToScreen,
  screenToWorld,
  WORLD_SIZE,
} from './world.js';
import { MetroNetwork, METHODS, SNAP_RADIUS, ERASE_RADIUS, STATION_RADIUS } from './metro.js';
import { PassengerSim } from './passenger.js';
import { UI } from './ui.js';
import { FeedbackFX } from './feedback.js';
import { saveGame, loadGame, applyDemand } from './save.js';

class Game {
  constructor() {
    this.tool = 'select';
    this.method = 'elevated';
    this.snapNodes = true;
    this.gridSnap = false;

    this.wrap = document.getElementById('canvas-wrap');
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.wrap.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.cam = { x: 0, z: 4, zoom: 7.5 };
    this._pointerDownPos = null;
    this._dragging = false;
    this._panning = false;
    this._lastPan = null;
    this._spacePan = false;

    this.baseMap = bakeCityBase(800);
    this.demandGrid = createDemandGrid(20);
    this.network = new MetroNetwork();
    this.passenger = new PassengerSim(this.network, this.demandGrid);
    this.network.createLine('#3aa0ff');

    this.ui = new UI(this);
    this.feedback = new FeedbackFX(this.network, this.passenger, this.ui);
    this.ui.refreshLineList();
    this.ui.refreshStats();

    this._bindPointer();
    this._bindWheel();
    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    this._last = performance.now();
    this._elapsed = 0;
    this.animate();

    this.ui.toast('欢迎来到青岚市！2D 俯视图 · 新建线路后「铺轨」· Z 撤销 · Esc 结束');
  }

  setTool(tool) {
    this.tool = tool;
    this.network.cancelPending();
    this.ui.hidePreview();
    this.ui.updateBuildHints?.();
    this.canvas.style.cursor =
      tool === 'select' ? 'grab' : tool === 'erase' ? 'not-allowed' : 'crosshair';
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
    const at = saveGame(this.network, this.demandGrid, { tool: this.tool, view: '2d' });
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

  onResize() {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = w;
    this.viewH = h;
  }

  _bindWheel() {
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const before = screenToWorld(sx, sy, this.cam, this.viewW, this.viewH);
        const factor = e.deltaY > 0 ? 0.9 : 1.11;
        this.cam.zoom = Math.max(2.5, Math.min(28, this.cam.zoom * factor));
        const after = screenToWorld(sx, sy, this.cam, this.viewW, this.viewH);
        this.cam.x += before.x - after.x;
        this.cam.z += before.z - after.z;
        this._clampCam();
      },
      { passive: false }
    );
  }

  _clampCam() {
    const lim = WORLD_SIZE / 2 - 5;
    this.cam.x = Math.max(-lim, Math.min(lim, this.cam.x));
    this.cam.z = Math.max(-lim, Math.min(lim, this.cam.z));
  }

  _bindPointer() {
    const el = this.canvas;
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointerleave', () => {
      this._panning = false;
      this._lastPan = null;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') this._spacePan = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this._spacePan = false;
    });
  }

  _eventToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    return screenToWorld(sx, sy, this.cam, this.viewW, this.viewH);
  }

  onPointerMove(event) {
    if (this._pointerDownPos) {
      const dx = event.clientX - this._pointerDownPos.x;
      const dy = event.clientY - this._pointerDownPos.y;
      if (dx * dx + dy * dy > 36) this._dragging = true;
    }

    // 平移：中键 / 右键 / 空格+左键 / 选择工具下左键拖拽
    if (this._panning && this._lastPan) {
      const dx = event.clientX - this._lastPan.x;
      const dy = event.clientY - this._lastPan.y;
      this.cam.x -= dx / this.cam.zoom;
      this.cam.z -= dy / this.cam.zoom;
      this._clampCam();
      this._lastPan = { x: event.clientX, y: event.clientY };
      return;
    }

    if (this.tool !== 'track') {
      this.network.clearGhost();
      if (this.tool !== 'station') this.ui.hidePreview();
      return;
    }
    const hit = this._eventToWorld(event);
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
    const panButton = event.button === 1 || event.button === 2;
    const selectPan = event.button === 0 && (this.tool === 'select' || this._spacePan);
    if (panButton || selectPan) {
      this._panning = true;
      this._lastPan = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture?.(event.pointerId);
      this.canvas.style.cursor = 'grabbing';
    }
    if (event.button === 0) {
      this._pointerDownPos = { x: event.clientX, y: event.clientY };
      this._dragging = false;
    }
  }

  onPointerUp(event) {
    if (this._panning) {
      this._panning = false;
      this._lastPan = null;
      this.canvas.style.cursor =
        this.tool === 'select' ? 'grab' : this.tool === 'erase' ? 'not-allowed' : 'crosshair';
    }
    if (event.button !== 0) return;
    const wasDragging = this._dragging;
    this._pointerDownPos = null;
    this._dragging = false;
    if (wasDragging) return;
    if (this.tool === 'select' || this._spacePan) return;

    const hit = this._eventToWorld(event);

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
      const node = this.network.findNearbyNode(hit.x, hit.z, STATION_RADIUS);
      if (!node) {
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
      const ok = this.network.eraseNear(hit.x, hit.z, ERASE_RADIUS);
      this.ui.toast(ok ? '已删除节点及相连轨道' : '附近没有节点');
      this.passenger.simulate();
      this.ui.refreshStats();
      this.ui.refreshLineList();
    }
  }

  _toScreen(x, z) {
    return worldToScreen(x, z, this.cam, this.viewW, this.viewH);
  }

  render(time) {
    const ctx = this.ctx;
    const w = this.viewW;
    const h = this.viewH;
    ctx.setTransform(
      Math.min(window.devicePixelRatio || 1, 2),
      0,
      0,
      Math.min(window.devicePixelRatio || 1, 2),
      0,
      0
    );

    // 背景 + 城市底图
    ctx.fillStyle = '#0a1424';
    ctx.fillRect(0, 0, w, h);

    const scale = this.cam.zoom;
    const left = w / 2 + (-WORLD_SIZE / 2 - this.cam.x) * scale;
    const top = h / 2 + (-WORLD_SIZE / 2 - this.cam.z) * scale;
    const size = WORLD_SIZE * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.baseMap, left, top, size, size);

    // 覆盖率淡色（可选：有地铁覆盖的需求格）
    if (this.passenger.enabled) {
      for (const cell of this.demandGrid.cells) {
        if (!cell.covered) continue;
        const p = this._toScreen(cell.x, cell.z);
        const r = (this.demandGrid.step * 0.45) * scale;
        ctx.fillStyle = 'rgba(80,180,255,0.06)';
        ctx.fillRect(p.sx - r, p.sy - r, r * 2, r * 2);
      }
    }

    // 网格辅助（开网格吸附时）
    if (this.gridSnap && this.tool === 'track') {
      ctx.strokeStyle = 'rgba(180,210,255,0.12)';
      ctx.lineWidth = 1;
      const step = 2;
      for (let gx = -60; gx <= 60; gx += step) {
        const a = this._toScreen(gx, -60);
        const b = this._toScreen(gx, 60);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
      for (let gz = -60; gz <= 60; gz += step) {
        const a = this._toScreen(-60, gz);
        const b = this._toScreen(60, gz);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }

    const toScreen = (x, z) => this._toScreen(x, z);
    this.network.draw(ctx, toScreen, this.cam.zoom, time);
    this.feedback.draw(ctx, toScreen, this.cam.zoom);

    // 指南 / 比例尺
    ctx.fillStyle = 'rgba(200,220,245,0.55)';
    ctx.font = '11px "PingFang SC",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('滚轮缩放 · 拖拽平移 · 右键亦可平移', 210, h - 16);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this._elapsed += dt;

    this.passenger.update(dt);
    this.feedback.update(dt);
    this.ui.refreshStats();
    this.ui.drawMinimap();
    this.ui.updateRidershipChart?.();
    this.render(this._elapsed);
  }
}

const game = new Game();
window.__metroGame = game;
window.__METHODS = METHODS;
