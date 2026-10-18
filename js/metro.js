/**
 * 地铁网络：线路、节点、站点、轨道渲染
 */
import * as THREE from 'three';
import { evaluateSegment, METHODS } from './construction.js';
import { sampleHeight } from './world.js';

const LINE_COLORS = ['#3aa0ff', '#ff5a5a', '#40d080', '#f0c040', '#c060ff', '#ff80c0', '#40e0e0', '#ff9040'];

let _id = 1;
export function nextId(prefix = 'id') {
  return `${prefix}_${_id++}`;
}
export function resetIdCounter(n = 1) {
  _id = n;
}

export class MetroNetwork {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'metro';
    scene.add(this.group);

    this.lines = []; // { id, name, color, frequency, nodeIds, stationIds }
    this.nodes = new Map(); // id -> { id, x, z, y, station, mesh, lineIds }
    this.segments = []; // { id, lineId, a, b, method, time, difficulty, mesh, load, capacity }
    this.activeLineId = null;
    this.pendingPath = []; // node ids being drawn
    this.ghostLine = null;
    this.previewMarker = null;

    this.nodeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x335566, roughness: 0.4 });
    this.stationMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xaaccff,
      emissiveIntensity: 0.6,
      roughness: 0.35,
    });
  }

  createLine(color) {
    const idx = this.lines.length + 1;
    const c = color || LINE_COLORS[(idx - 1) % LINE_COLORS.length];
    const line = {
      id: nextId('line'),
      name: `${idx}号线`,
      color: c,
      frequency: 'mid', // low | mid | high
      nodeIds: [],
      stationIds: [],
    };
    this.lines.push(line);
    this.activeLineId = line.id;
    return line;
  }

  getLine(id) {
    return this.lines.find((l) => l.id === id);
  }

  getActiveLine() {
    return this.getLine(this.activeLineId);
  }

  setActiveLine(id) {
    this.activeLineId = id;
    this.pendingPath = [];
    this.clearGhost();
  }

  setLineColor(id, color) {
    const line = this.getLine(id);
    if (!line) return;
    line.color = color;
    this.rebuildLineMeshes(id);
  }

  setFrequency(id, freq) {
    const line = this.getLine(id);
    if (!line) return;
    line.frequency = freq;
  }

  /** 世界坐标落点高度 */
  groundY(x, z) {
    return sampleHeight(x, z) * 0.15 + 0.6;
  }

  findNearbyNode(x, z, radius = 2.5) {
    let best = null;
    let bestD = radius;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  addNode(x, z, opts = {}) {
    const y = this.groundY(x, z);
    const id = opts.id || nextId('node');
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 12), this.nodeMat.clone());
    mesh.position.set(x, y, z);
    mesh.userData = { type: 'node', id };
    this.group.add(mesh);
    const node = { id, x, z, y, station: false, mesh, lineIds: new Set() };
    this.nodes.set(id, node);
    return node;
  }

  makeStation(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    if (node.station) return node;
    node.station = true;
    // 换成站点样式
    this.group.remove(node.mesh);
    node.mesh.geometry.dispose();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.95, 0.55, 16),
      this.stationMat.clone()
    );
    mesh.position.set(node.x, node.y + 0.15, node.z);
    mesh.userData = { type: 'station', id: node.id };
    // 光环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.45, 24),
      new THREE.MeshBasicMaterial({ color: 0xaaddff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    mesh.add(ring);
    this.group.add(mesh);
    node.mesh = mesh;

    const line = this.getActiveLine();
    if (line && !line.stationIds.includes(node.id)) line.stationIds.push(node.id);
    // 所有经过该节点的线路也登记
    for (const lid of node.lineIds) {
      const L = this.getLine(lid);
      if (L && !L.stationIds.includes(node.id)) L.stationIds.push(node.id);
    }
    return node;
  }

  /**
   * 铺轨：从 last 到 (x,z)，使用当前工法
   * @returns {{ success, eval, node } | { success:false, reason, eval }}
   */
  placeTrackPoint(x, z, methodId, snap = true) {
    const line = this.getActiveLine();
    if (!line) return { success: false, reason: '请先新建或选择线路' };

    let node = snap ? this.findNearbyNode(x, z, 2.8) : null;
    if (!node) {
      // 限制在地图内
      if (Math.abs(x) > 58 || Math.abs(z) > 58) {
        return { success: false, reason: '超出地图范围' };
      }
      node = this.addNode(x, z);
    }

    if (this.pendingPath.length === 0) {
      this.pendingPath.push(node.id);
      node.lineIds.add(line.id);
      if (!line.nodeIds.includes(node.id)) line.nodeIds.push(node.id);
      return { success: true, node, started: true };
    }

    const prevId = this.pendingPath[this.pendingPath.length - 1];
    if (prevId === node.id) return { success: false, reason: '与上一点相同' };

    const prev = this.nodes.get(prevId);
    const ev = evaluateSegment(prev.x, prev.z, node.x, node.z, methodId);
    if (ev.blocked) {
      return { success: false, reason: ev.message, eval: ev };
    }

    // 创建线段
    this.addSegment(line, prev, node, methodId, ev);
    this.pendingPath.push(node.id);
    node.lineIds.add(line.id);
    if (!line.nodeIds.includes(node.id)) line.nodeIds.push(node.id);
    return { success: true, node, eval: ev };
  }

  addSegment(line, a, b, methodId, ev) {
    // 避免完全重复
    const exists = this.segments.find(
      (s) => s.lineId === line.id && ((s.a === a.id && s.b === b.id) || (s.a === b.id && s.b === a.id))
    );
    if (exists) return exists;

    const curvePts = this._segmentPoints(a, b, methodId);
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const color = new THREE.Color(line.color);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    });
    // 发光近似：再加一层稍粗半透明管
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.28, 6, false), mat);
    tube.userData = { type: 'segment' };
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.55, 6, false), glowMat);
    glow.userData = { type: 'segmentGlow' };

    const wrap = new THREE.Group();
    wrap.add(tube);
    wrap.add(glow);
    this.group.add(wrap);

    const seg = {
      id: nextId('seg'),
      lineId: line.id,
      a: a.id,
      b: b.id,
      method: methodId,
      time: ev.time,
      difficulty: ev.difficulty,
      length: ev.length,
      mesh: wrap,
      tube,
      glow,
      load: 0,
      capacity: 80,
      congestion: 0,
    };
    this.segments.push(seg);

    // 建造中短暂缩放动画感：用 opacity 闪一下
    tube.material.opacity = 0.3;
    setTimeout(() => {
      if (tube.material) tube.material.opacity = 0.95;
    }, Math.min(2000, ev.time * 40));

    return seg;
  }

  _segmentPoints(a, b, methodId) {
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    let yLift = 0.9;
    if (methodId === 'elevated') yLift = 2.2;
    if (methodId === 'bridge') yLift = 2.8;
    if (methodId === 'mountain_tunnel' || methodId === 'shield') yLift = 0.35;
    if (methodId === 'cut_cover') yLift = 0.55;

    const ay = a.y + (methodId === 'elevated' || methodId === 'bridge' ? 1.4 : 0.2);
    const by = b.y + (methodId === 'elevated' || methodId === 'bridge' ? 1.4 : 0.2);
    mid.y = (ay + by) / 2 + yLift * 0.3;

    // 隧道略埋入
    if (methodId === 'mountain_tunnel' || methodId === 'shield') {
      mid.y = Math.min(ay, by) - 0.8;
    }
    if (methodId === 'bridge') {
      mid.y = Math.max(ay, by) + 1.5;
    }

    return [
      new THREE.Vector3(a.x, ay, a.z),
      mid,
      new THREE.Vector3(b.x, by, b.z),
    ];
  }

  updateGhost(x, z, methodId) {
    this.clearGhost();
    if (this.pendingPath.length === 0) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
      );
      m.position.set(x, this.groundY(x, z), z);
      this.group.add(m);
      this.ghostLine = m;
      return null;
    }
    const prev = this.nodes.get(this.pendingPath[this.pendingPath.length - 1]);
    const line = this.getActiveLine();
    const ev = evaluateSegment(prev.x, prev.z, x, z, methodId);
    const color = ev.blocked ? 0xff4050 : new THREE.Color(line?.color || '#ffffff').getHex();
    const pts = this._segmentPoints(
      prev,
      { x, z, y: this.groundY(x, z) },
      methodId
    );
    const curve = new THREE.CatmullRomCurve3(pts);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 12, 0.22, 5, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
    );
    this.group.add(mesh);
    this.ghostLine = mesh;
    return ev;
  }

  clearGhost() {
    if (this.ghostLine) {
      this.group.remove(this.ghostLine);
      this.ghostLine.geometry?.dispose?.();
      this.ghostLine.material?.dispose?.();
      this.ghostLine = null;
    }
  }

  cancelPending() {
    this.pendingPath = [];
    this.clearGhost();
  }

  eraseNear(x, z, radius = 2.5) {
    const node = this.findNearbyNode(x, z, radius);
    if (!node) return false;
    // 删除相关线段
    const toRemove = this.segments.filter((s) => s.a === node.id || s.b === node.id);
    for (const s of toRemove) {
      this.group.remove(s.mesh);
      s.tube.geometry.dispose();
      s.glow.geometry.dispose();
      this.segments = this.segments.filter((x) => x.id !== s.id);
    }
    this.group.remove(node.mesh);
    node.mesh.geometry?.dispose?.();
    this.nodes.delete(node.id);
    for (const line of this.lines) {
      line.nodeIds = line.nodeIds.filter((id) => id !== node.id);
      line.stationIds = line.stationIds.filter((id) => id !== node.id);
    }
    this.pendingPath = this.pendingPath.filter((id) => id !== node.id);
    return true;
  }

  rebuildLineMeshes(lineId) {
    const line = this.getLine(lineId);
    if (!line) return;
    const color = new THREE.Color(line.color);
    for (const s of this.segments) {
      if (s.lineId !== lineId) continue;
      // 拥堵色优先，无负载时用线路色
      if (s.congestion <= 0.05) {
        s.tube.material.color.copy(color);
        s.glow.material.color.copy(color);
      }
    }
  }

  /** 按拥堵更新线段颜色 green→yellow→red，混入线路色 */
  applyCongestionColors() {
    for (const s of this.segments) {
      const c = s.congestion; // 0~1+
      const line = this.getLine(s.lineId);
      const base = new THREE.Color(line?.color || '#ffffff');
      let congestionColor;
      if (c < 0.5) congestionColor = new THREE.Color(0x40d060);
      else if (c < 0.85) congestionColor = new THREE.Color(0xe0c040);
      else congestionColor = new THREE.Color(0xe04040);
      // 有客流时偏向拥堵色，否则线路色
      const mix = Math.min(1, c * 1.2);
      const out = base.clone().lerp(congestionColor, mix);
      s.tube.material.color.copy(out);
      s.glow.material.color.copy(out);
      s.glow.material.opacity = 0.2 + Math.min(0.45, c * 0.4);
    }
  }

  getStations() {
    return [...this.nodes.values()].filter((n) => n.station);
  }

  /** 序列化 */
  toJSON() {
    return {
      version: 1,
      idCounter: _id,
      activeLineId: this.activeLineId,
      lines: this.lines.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        frequency: l.frequency,
        nodeIds: l.nodeIds,
        stationIds: l.stationIds,
      })),
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id,
        x: n.x,
        z: n.z,
        station: n.station,
        lineIds: [...n.lineIds],
      })),
      segments: this.segments.map((s) => ({
        id: s.id,
        lineId: s.lineId,
        a: s.a,
        b: s.b,
        method: s.method,
        time: s.time,
        difficulty: s.difficulty,
        length: s.length,
      })),
    };
  }

  clearNetwork() {
    for (const s of this.segments) {
      this.group.remove(s.mesh);
      s.tube.geometry.dispose();
      s.glow.geometry.dispose();
    }
    for (const n of this.nodes.values()) {
      this.group.remove(n.mesh);
      n.mesh.geometry?.dispose?.();
    }
    this.segments = [];
    this.nodes.clear();
    this.lines = [];
    this.pendingPath = [];
    this.clearGhost();
    this.activeLineId = null;
  }

  fromJSON(data) {
    this.clearNetwork();
    if (data.idCounter) resetIdCounter(data.idCounter);
    for (const n of data.nodes || []) {
      const node = this.addNode(n.x, n.z, { id: n.id });
      node.lineIds = new Set(n.lineIds || []);
      if (n.station) this.makeStation(node.id);
    }
    for (const l of data.lines || []) {
      this.lines.push({
        id: l.id,
        name: l.name,
        color: l.color,
        frequency: l.frequency || 'mid',
        nodeIds: l.nodeIds || [],
        stationIds: l.stationIds || [],
      });
    }
    for (const s of data.segments || []) {
      const line = this.getLine(s.lineId);
      const a = this.nodes.get(s.a);
      const b = this.nodes.get(s.b);
      if (!line || !a || !b) continue;
      const ev = {
        time: s.time,
        difficulty: s.difficulty,
        length: s.length || Math.hypot(a.x - b.x, a.z - b.z),
      };
      const seg = this.addSegment(line, a, b, s.method, ev);
      seg.id = s.id;
    }
    this.activeLineId = data.activeLineId || this.lines[0]?.id || null;
  }
}

export { METHODS, LINE_COLORS };
