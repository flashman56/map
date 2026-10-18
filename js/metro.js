/**
 * 地铁网络：线路、节点、站点、轨道渲染、吸附幽灵、撤销
 */
import * as THREE from 'three';
import { evaluateSegment, METHODS } from './construction.js';
import { sampleHeight } from './world.js';

const LINE_COLORS = ['#3aa0ff', '#ff5a5a', '#40d080', '#f0c040', '#c060ff', '#ff80c0', '#40e0e0', '#ff9040'];

export const SNAP_RADIUS = 3.6;
export const ERASE_RADIUS = 3.8;
export const STATION_RADIUS = 4.2;

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

    this.lines = [];
    this.nodes = new Map();
    this.segments = [];
    this.activeLineId = null;
    this.pendingPath = [];
    this.ghostGroup = null;
    this.snapTargetId = null;
    this.undoStack = []; // { type:'segment'|'start', ... }

    this.nodeMat = new THREE.MeshStandardMaterial({
      color: 0xf0f6ff,
      emissive: 0x224466,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.25,
    });
    this.stationMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x88bbff,
      emissiveIntensity: 0.7,
      roughness: 0.28,
      metalness: 0.35,
    });
  }

  createLine(color) {
    const idx = this.lines.length + 1;
    const c = color || LINE_COLORS[(idx - 1) % LINE_COLORS.length];
    const line = {
      id: nextId('line'),
      name: `${idx}号线`,
      color: c,
      frequency: 'mid',
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

  groundY(x, z) {
    return sampleHeight(x, z) * 0.15 + 0.55;
  }

  findNearbyNode(x, z, radius = SNAP_RADIUS) {
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

  /** Soft snap: returns {x,z,node,snapped} with optional grid assist */
  resolveSnap(x, z, snapNodes = true, gridSnap = false) {
    let node = null;
    if (snapNodes) {
      node = this.findNearbyNode(x, z, SNAP_RADIUS);
      if (node) {
        return { x: node.x, z: node.z, node, snapped: true, snapDist: Math.hypot(node.x - x, node.z - z) };
      }
    }
    if (gridSnap) {
      const g = 2;
      x = Math.round(x / g) * g;
      z = Math.round(z / g) * g;
    }
    return { x, z, node: null, snapped: false, snapDist: Infinity };
  }

  addNode(x, z, opts = {}) {
    const y = this.groundY(x, z);
    const id = opts.id || nextId('node');
    // Larger hit sphere + visible core
    const wrap = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 16),
      this.nodeMat.clone()
    );
    core.castShadow = true;
    // Invisible larger pick target (visual only as faint ring)
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.05, 24),
      new THREE.MeshBasicMaterial({
        color: 0xaad8ff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.35;
    wrap.add(core);
    wrap.add(halo);
    wrap.position.set(x, y, z);
    wrap.userData = { type: 'node', id };
    this.group.add(wrap);
    const node = { id, x, z, y, station: false, mesh: wrap, core, halo, lineIds: new Set() };
    this.nodes.set(id, node);
    return node;
  }

  makeStation(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    if (node.station) return node;
    node.station = true;
    this.group.remove(node.mesh);
    node.mesh.traverse?.((c) => {
      c.geometry?.dispose?.();
    });

    const wrap = new THREE.Group();
    // Platform disc
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.25, 0.28, 24),
      new THREE.MeshStandardMaterial({
        color: 0xe8f0ff,
        emissive: 0x6699cc,
        emissiveIntensity: 0.35,
        roughness: 0.4,
        metalness: 0.3,
      })
    );
    pad.position.y = 0.05;
    pad.castShadow = true;
    // Pillar / canopy
    const canopy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.45, 1.1, 12),
      this.stationMat.clone()
    );
    canopy.position.y = 0.75;
    canopy.castShadow = true;
    // Roof
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.35, 0.12, 24),
      new THREE.MeshStandardMaterial({
        color: 0x4a90d8,
        emissive: 0x2266aa,
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.4,
      })
    );
    roof.position.y = 1.35;
    // Outer glow ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.4, 1.85, 32),
      new THREE.MeshBasicMaterial({
        color: 0xaaddff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;

    wrap.add(pad);
    wrap.add(canopy);
    wrap.add(roof);
    wrap.add(ring);
    wrap.position.set(node.x, node.y, node.z);
    wrap.userData = { type: 'station', id: node.id };
    this.group.add(wrap);
    node.mesh = wrap;
    node.halo = ring;

    const line = this.getActiveLine();
    if (line && !line.stationIds.includes(node.id)) line.stationIds.push(node.id);
    for (const lid of node.lineIds) {
      const L = this.getLine(lid);
      if (L && !L.stationIds.includes(node.id)) L.stationIds.push(node.id);
    }
    return node;
  }

  placeTrackPoint(x, z, methodId, snap = true, gridSnap = false) {
    const line = this.getActiveLine();
    if (!line) return { success: false, reason: '请先新建或选择线路' };

    const resolved = this.resolveSnap(x, z, snap, gridSnap);
    let node = resolved.node;
    if (!node) {
      if (Math.abs(resolved.x) > 58 || Math.abs(resolved.z) > 58) {
        return { success: false, reason: '超出地图范围' };
      }
      node = this.addNode(resolved.x, resolved.z);
    }

    if (this.pendingPath.length === 0) {
      this.pendingPath.push(node.id);
      node.lineIds.add(line.id);
      if (!line.nodeIds.includes(node.id)) line.nodeIds.push(node.id);
      this.undoStack.push({ type: 'start', nodeId: node.id, created: !resolved.snapped });
      this._highlightNode(node, true);
      return { success: true, node, started: true, snapped: resolved.snapped };
    }

    const prevId = this.pendingPath[this.pendingPath.length - 1];
    if (prevId === node.id) return { success: false, reason: '与上一点相同' };

    const prev = this.nodes.get(prevId);
    const ev = evaluateSegment(prev.x, prev.z, node.x, node.z, methodId);
    if (ev.blocked) {
      return { success: false, reason: ev.message, eval: ev };
    }

    const seg = this.addSegment(line, prev, node, methodId, ev);
    this.pendingPath.push(node.id);
    node.lineIds.add(line.id);
    if (!line.nodeIds.includes(node.id)) line.nodeIds.push(node.id);
    this.undoStack.push({
      type: 'segment',
      segId: seg.id,
      nodeId: node.id,
      createdNode: !resolved.snapped,
      prevId,
    });
    this._highlightNode(node, true);
    this._highlightNode(prev, false);
    return { success: true, node, eval: ev, snapped: resolved.snapped };
  }

  /** Undo last placed track node / segment in the current stroke */
  undoLastNode() {
    if (this.undoStack.length === 0 && this.pendingPath.length === 0) {
      return { success: false, reason: '没有可撤销的节点' };
    }
    // Prefer undo stack tied to pending stroke
    const last = this.undoStack.pop();
    if (!last) {
      this.pendingPath.pop();
      this.clearGhost();
      return { success: true };
    }

    if (last.type === 'start') {
      this.pendingPath = this.pendingPath.filter((id) => id !== last.nodeId);
      const node = this.nodes.get(last.nodeId);
      if (node) this._highlightNode(node, false);
      // Only remove node if orphaned and we created it
      if (last.created && node && this._isOrphanNode(node.id)) {
        this._removeNodeOnly(node.id);
      }
      this.clearGhost();
      return { success: true, undid: 'start' };
    }

    if (last.type === 'segment') {
      const seg = this.segments.find((s) => s.id === last.segId);
      if (seg) {
        this.group.remove(seg.mesh);
        seg.tube?.geometry?.dispose?.();
        seg.glow?.geometry?.dispose?.();
        this.segments = this.segments.filter((s) => s.id !== last.segId);
      }
      this.pendingPath = this.pendingPath.filter((id) => id !== last.nodeId);
      // Keep prev as tip
      if (last.prevId && !this.pendingPath.includes(last.prevId)) {
        // pending should still have prev
      }
      // Ensure pending ends at prev
      if (this.pendingPath.length === 0 && last.prevId) {
        this.pendingPath.push(last.prevId);
      } else if (this.pendingPath[this.pendingPath.length - 1] !== last.prevId && last.prevId) {
        // trim until prev
        while (this.pendingPath.length && this.pendingPath[this.pendingPath.length - 1] !== last.prevId) {
          this.pendingPath.pop();
        }
        if (!this.pendingPath.length) this.pendingPath.push(last.prevId);
      }

      const node = this.nodes.get(last.nodeId);
      if (node) this._highlightNode(node, false);
      const prev = this.nodes.get(last.prevId);
      if (prev) this._highlightNode(prev, true);

      if (last.createdNode && node && this._isOrphanNode(node.id)) {
        this._removeNodeOnly(node.id);
      }
      this.clearGhost();
      return { success: true, undid: 'segment' };
    }
    return { success: false };
  }

  _isOrphanNode(nodeId) {
    const used = this.segments.some((s) => s.a === nodeId || s.b === nodeId);
    return !used;
  }

  _removeNodeOnly(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.group.remove(node.mesh);
    node.mesh.traverse?.((c) => c.geometry?.dispose?.());
    this.nodes.delete(nodeId);
    for (const line of this.lines) {
      line.nodeIds = line.nodeIds.filter((id) => id !== nodeId);
      line.stationIds = line.stationIds.filter((id) => id !== nodeId);
    }
  }

  _highlightNode(node, on) {
    if (!node?.halo?.material) return;
    if (node.station) {
      node.halo.material.opacity = on ? 0.95 : 0.65;
      node.halo.material.color.setHex(on ? 0xffe080 : 0xaaddff);
    } else {
      node.halo.material.opacity = on ? 0.85 : 0.35;
      node.halo.material.color.setHex(on ? 0xffe080 : 0xaad8ff);
      if (node.core) node.core.scale.setScalar(on ? 1.25 : 1);
    }
  }

  addSegment(line, a, b, methodId, ev) {
    const exists = this.segments.find(
      (s) => s.lineId === line.id && ((s.a === a.id && s.b === b.id) || (s.a === b.id && s.b === a.id))
    );
    if (exists) return exists;

    const curvePts = this._segmentPoints(a, b, methodId);
    const curve = new THREE.CatmullRomCurve3(curvePts);
    const color = new THREE.Color(line.color);

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.35),
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.35,
      transparent: true,
      opacity: 0.98,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.32, 8, false), mat);
    tube.castShadow = true;
    tube.userData = { type: 'segment' };

    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.62, 8, false), glowMat);
    glow.userData = { type: 'segmentGlow' };

    // Method marker stripe (thin darker tube offset feel via second color)
    const stripeMat = new THREE.MeshBasicMaterial({
      color: methodId === 'bridge' ? 0xffcc66
        : methodId === 'mountain_tunnel' || methodId === 'shield' ? 0x668899
        : methodId === 'cut_cover' ? 0xaa8866
        : color.clone().offsetHSL(0, 0, 0.15).getHex(),
      transparent: true,
      opacity: 0.55,
    });
    const stripe = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.12, 4, false), stripeMat);

    const wrap = new THREE.Group();
    wrap.add(glow);
    wrap.add(tube);
    wrap.add(stripe);
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
      stripe,
      load: 0,
      capacity: 80,
      congestion: 0,
    };
    this.segments.push(seg);

    tube.material.opacity = 0.25;
    const fadeMs = Math.min(1800, Math.max(400, ev.time * 35));
    const t0 = performance.now();
    const fade = () => {
      if (!tube.material) return;
      const p = Math.min(1, (performance.now() - t0) / fadeMs);
      tube.material.opacity = 0.25 + 0.73 * p;
      if (p < 1) requestAnimationFrame(fade);
    };
    requestAnimationFrame(fade);

    return seg;
  }

  _segmentPoints(a, b, methodId) {
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    let yLift = 0.9;
    if (methodId === 'elevated') yLift = 2.2;
    if (methodId === 'bridge') yLift = 2.8;
    if (methodId === 'mountain_tunnel' || methodId === 'shield') yLift = 0.35;
    if (methodId === 'cut_cover') yLift = 0.55;

    const ay = a.y + (methodId === 'elevated' || methodId === 'bridge' ? 1.5 : 0.25);
    const by = b.y + (methodId === 'elevated' || methodId === 'bridge' ? 1.5 : 0.25);
    mid.y = (ay + by) / 2 + yLift * 0.3;

    if (methodId === 'mountain_tunnel' || methodId === 'shield') {
      mid.y = Math.min(ay, by) - 0.9;
    }
    if (methodId === 'bridge') {
      mid.y = Math.max(ay, by) + 1.6;
    }

    return [
      new THREE.Vector3(a.x, ay, a.z),
      mid,
      new THREE.Vector3(b.x, by, b.z),
    ];
  }

  updateGhost(x, z, methodId, snap = true, gridSnap = false) {
    this.clearGhost();
    const resolved = this.resolveSnap(x, z, snap, gridSnap);
    this.snapTargetId = resolved.node?.id || null;
    const gx = resolved.x;
    const gz = resolved.z;
    const gy = this.groundY(gx, gz);

    const g = new THREE.Group();

    // Cursor / snap marker
    const markerCol = resolved.snapped ? 0xffe080 : 0xffffff;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(resolved.snapped ? 0.65 : 0.48, 14, 14),
      new THREE.MeshBasicMaterial({ color: markerCol, transparent: true, opacity: 0.7 })
    );
    marker.position.set(gx, gy, gz);
    g.add(marker);

    // Snap ring (clearer magnetic feel)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(resolved.snapped ? 1.1 : 0.85, resolved.snapped ? 1.55 : 1.2, 32),
      new THREE.MeshBasicMaterial({
        color: resolved.snapped ? 0xffd060 : 0x88b8ff,
        transparent: true,
        opacity: resolved.snapped ? 0.85 : 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(gx, 0.1, gz);
    g.add(ring);

    // Snap radius guide when near a node
    if (resolved.snapped && resolved.node) {
      const guide = new THREE.Mesh(
        new THREE.RingGeometry(SNAP_RADIUS * 0.95, SNAP_RADIUS, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffe080,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      guide.rotation.x = -Math.PI / 2;
      guide.position.set(resolved.node.x, 0.09, resolved.node.z);
      g.add(guide);
    }

    let ev = null;
    if (this.pendingPath.length > 0) {
      const prev = this.nodes.get(this.pendingPath[this.pendingPath.length - 1]);
      const line = this.getActiveLine();
      ev = evaluateSegment(prev.x, prev.z, gx, gz, methodId);
      const color = ev.blocked
        ? 0xff3040
        : new THREE.Color(line?.color || '#ffffff').getHex();
      const pts = this._segmentPoints(prev, { x: gx, z: gz, y: gy }, methodId);
      const curve = new THREE.CatmullRomCurve3(pts);
      const ghostTube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 16, 0.26, 6, false),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: ev.blocked ? 0.45 : 0.62,
          depthWrite: false,
        })
      );
      g.add(ghostTube);
      // Outer dashed-feel glow
      const ghostGlow = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 12, 0.48, 6, false),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        })
      );
      g.add(ghostGlow);

      // Length tick at midpoint
      const mid = curve.getPoint(0.5);
      const lenLabel = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshBasicMaterial({ color: ev.blocked ? 0xff4050 : 0xffffff, opacity: 0.8, transparent: true })
      );
      lenLabel.position.copy(mid);
      g.add(lenLabel);
    }

    this.group.add(g);
    this.ghostGroup = g;
    return ev;
  }

  clearGhost() {
    if (this.ghostGroup) {
      this.group.remove(this.ghostGroup);
      this.ghostGroup.traverse((c) => {
        c.geometry?.dispose?.();
        if (c.material && !Array.isArray(c.material)) c.material.dispose?.();
      });
      this.ghostGroup = null;
    }
    this.snapTargetId = null;
  }

  cancelPending() {
    for (const id of this.pendingPath) {
      const n = this.nodes.get(id);
      if (n) this._highlightNode(n, false);
    }
    this.pendingPath = [];
    this.undoStack = [];
    this.clearGhost();
  }

  eraseNear(x, z, radius = ERASE_RADIUS) {
    const node = this.findNearbyNode(x, z, radius);
    if (!node) return false;
    const toRemove = this.segments.filter((s) => s.a === node.id || s.b === node.id);
    for (const s of toRemove) {
      this.group.remove(s.mesh);
      s.tube?.geometry?.dispose?.();
      s.glow?.geometry?.dispose?.();
      s.stripe?.geometry?.dispose?.();
      this.segments = this.segments.filter((x) => x.id !== s.id);
    }
    this.group.remove(node.mesh);
    node.mesh.traverse?.((c) => c.geometry?.dispose?.());
    this.nodes.delete(node.id);
    for (const line of this.lines) {
      line.nodeIds = line.nodeIds.filter((id) => id !== node.id);
      line.stationIds = line.stationIds.filter((id) => id !== node.id);
    }
    this.pendingPath = this.pendingPath.filter((id) => id !== node.id);
    this.undoStack = [];
    return true;
  }

  rebuildLineMeshes(lineId) {
    const line = this.getLine(lineId);
    if (!line) return;
    const color = new THREE.Color(line.color);
    for (const s of this.segments) {
      if (s.lineId !== lineId) continue;
      if (s.congestion <= 0.05) {
        s.tube.material.color.copy(color);
        if (s.tube.material.emissive) s.tube.material.emissive.copy(color).multiplyScalar(0.35);
        s.glow.material.color.copy(color);
      }
    }
  }

  applyCongestionColors() {
    for (const s of this.segments) {
      const c = s.congestion;
      const line = this.getLine(s.lineId);
      const base = new THREE.Color(line?.color || '#ffffff');
      let congestionColor;
      if (c < 0.35) congestionColor = new THREE.Color(0x2ee06a);
      else if (c < 0.65) congestionColor = new THREE.Color(0xd0e040);
      else if (c < 0.85) congestionColor = new THREE.Color(0xf0a020);
      else congestionColor = new THREE.Color(0xff3030);
      const mix = c < 0.08 ? 0 : Math.min(1, 0.35 + c * 0.85);
      const out = base.clone().lerp(congestionColor, mix);
      s.tube.material.color.copy(out);
      if (s.tube.material.emissive) {
        s.tube.material.emissive.copy(out).multiplyScalar(0.3 + Math.min(0.5, c * 0.5));
        s.tube.material.emissiveIntensity = 0.45 + Math.min(0.7, c * 0.6);
      }
      s.glow.material.color.copy(out);
      s.glow.material.opacity = 0.22 + Math.min(0.5, c * 0.45);
      // Thicken feel via glow scale — recreate not needed; opacity carries it
      if (s.stripe?.material) {
        s.stripe.material.opacity = c > 0.85 ? 0.8 : 0.5;
      }
    }
  }

  getStations() {
    return [...this.nodes.values()].filter((n) => n.station);
  }

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
      s.tube?.geometry?.dispose?.();
      s.glow?.geometry?.dispose?.();
      s.stripe?.geometry?.dispose?.();
    }
    for (const n of this.nodes.values()) {
      this.group.remove(n.mesh);
      n.mesh.traverse?.((c) => c.geometry?.dispose?.());
    }
    this.segments = [];
    this.nodes.clear();
    this.lines = [];
    this.pendingPath = [];
    this.undoStack = [];
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
