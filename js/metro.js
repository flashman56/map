/**
 * 地铁网络（纯数据 + 2D 绘制辅助）：线路、节点、站点、幽灵预览、撤销
 */
import { evaluateSegment, METHODS } from './construction.js';

const LINE_COLORS = ['#3aa0ff', '#ff5a5a', '#40d080', '#f0c040', '#c060ff', '#ff80c0', '#40e0e0', '#ff9040'];

export const SNAP_RADIUS = 3.6;
export const ERASE_RADIUS = 3.8;
export const STATION_RADIUS = 4.2;
export { METHODS };

let _id = 1;
export function nextId(prefix = 'id') {
  return `${prefix}_${_id++}`;
}
export function resetIdCounter(n = 1) {
  _id = n;
}

export class MetroNetwork {
  constructor() {
    this.lines = [];
    this.nodes = new Map();
    this.segments = [];
    this.activeLineId = null;
    this.pendingPath = [];
    this.ghost = null; // { x, z, fromX, fromZ, blocked, color, snapped }
    this.snapTargetId = null;
    this.undoStack = [];
    this.highlightId = null;
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
    this.highlightId = null;
  }

  setLineColor(id, color) {
    const line = this.getLine(id);
    if (!line) return;
    line.color = color;
  }

  setFrequency(id, freq) {
    const line = this.getLine(id);
    if (!line) return;
    line.frequency = freq;
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

  resolveSnap(x, z, snapNodes = true, gridSnap = false) {
    let node = null;
    if (snapNodes) {
      node = this.findNearbyNode(x, z, SNAP_RADIUS);
      if (node) {
        return {
          x: node.x,
          z: node.z,
          node,
          snapped: true,
          snapDist: Math.hypot(node.x - x, node.z - z),
        };
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
    const id = opts.id || nextId('node');
    const node = {
      id,
      x,
      z,
      y: 0,
      station: !!opts.station,
      lineIds: new Set(opts.lineIds || []),
      visualScale: 1,
      highlight: false,
    };
    this.nodes.set(id, node);
    return node;
  }

  makeStation(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    if (node.station) return node;
    node.station = true;
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

  undoLastNode() {
    if (this.undoStack.length === 0 && this.pendingPath.length === 0) {
      return { success: false, reason: '没有可撤销的节点' };
    }
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
      if (last.created && node && this._isOrphanNode(node.id)) {
        this._removeNodeOnly(node.id);
      }
      this.clearGhost();
      return { success: true, undid: 'start' };
    }

    if (last.type === 'segment') {
      this.segments = this.segments.filter((s) => s.id !== last.segId);
      this.pendingPath = this.pendingPath.filter((id) => id !== last.nodeId);
      if (this.pendingPath.length === 0 && last.prevId) {
        this.pendingPath.push(last.prevId);
      } else if (this.pendingPath[this.pendingPath.length - 1] !== last.prevId && last.prevId) {
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
    return !this.segments.some((s) => s.a === nodeId || s.b === nodeId);
  }

  _removeNodeOnly(nodeId) {
    this.nodes.delete(nodeId);
    for (const line of this.lines) {
      line.nodeIds = line.nodeIds.filter((id) => id !== nodeId);
      line.stationIds = line.stationIds.filter((id) => id !== nodeId);
    }
  }

  _highlightNode(node, on) {
    if (!node) return;
    node.highlight = !!on;
    this.highlightId = on ? node.id : this.highlightId === node.id ? null : this.highlightId;
  }

  addSegment(line, a, b, methodId, ev) {
    const exists = this.segments.find(
      (s) => s.lineId === line.id && ((s.a === a.id && s.b === b.id) || (s.a === b.id && s.b === a.id))
    );
    if (exists) return exists;

    const seg = {
      id: nextId('seg'),
      lineId: line.id,
      a: a.id,
      b: b.id,
      method: methodId,
      time: ev?.time ?? 0,
      difficulty: ev?.difficulty ?? 0,
      load: 0,
      capacity: 80,
      congestion: 0,
    };
    this.segments.push(seg);
    a.lineIds.add(line.id);
    b.lineIds.add(line.id);
    return seg;
  }

  updateGhost(x, z, methodId, snap = true, gridSnap = false) {
    const line = this.getActiveLine();
    if (!line || this.pendingPath.length === 0) {
      // 仍显示吸附圈
      const resolved = this.resolveSnap(x, z, snap, gridSnap);
      this.ghost = {
        x: resolved.x,
        z: resolved.z,
        fromX: null,
        fromZ: null,
        blocked: false,
        color: line?.color || '#3aa0ff',
        snapped: resolved.snapped,
        eval: null,
      };
      this.snapTargetId = resolved.node?.id || null;
      return null;
    }

    const prev = this.nodes.get(this.pendingPath[this.pendingPath.length - 1]);
    if (!prev) {
      this.clearGhost();
      return null;
    }
    const resolved = this.resolveSnap(x, z, snap, gridSnap);
    const ev = evaluateSegment(prev.x, prev.z, resolved.x, resolved.z, methodId);
    this.ghost = {
      x: resolved.x,
      z: resolved.z,
      fromX: prev.x,
      fromZ: prev.z,
      blocked: !!ev.blocked,
      color: ev.blocked ? '#ff4040' : line.color,
      snapped: resolved.snapped,
      eval: ev,
      method: methodId,
    };
    this.snapTargetId = resolved.node?.id || null;
    return ev;
  }

  clearGhost() {
    this.ghost = null;
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
    const id = node.id;
    this.segments = this.segments.filter((s) => s.a !== id && s.b !== id);
    this.nodes.delete(id);
    for (const line of this.lines) {
      line.nodeIds = line.nodeIds.filter((nid) => nid !== id);
      line.stationIds = line.stationIds.filter((nid) => nid !== id);
    }
    this.pendingPath = this.pendingPath.filter((nid) => nid !== id);
    this.undoStack = [];
    this.clearGhost();
    return true;
  }

  getStations() {
    return [...this.nodes.values()].filter((n) => n.station);
  }

  applyCongestionColors() {
    // 2D：拥堵色在绘制时读取 seg.congestion，此处仅作占位兼容
  }

  /** 路段中点插值（供列车） */
  segmentLerp(seg, t) {
    const a = this.nodes.get(seg.a);
    const b = this.nodes.get(seg.b);
    if (!a || !b) return null;
    const tt = Math.max(0, Math.min(1, t));
    return {
      x: a.x + (b.x - a.x) * tt,
      z: a.z + (b.z - a.z) * tt,
      angle: Math.atan2(b.z - a.z, b.x - a.x),
    };
  }

  toJSON() {
    return {
      lines: this.lines.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        frequency: l.frequency,
        nodeIds: [...l.nodeIds],
        stationIds: [...l.stationIds],
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
      })),
      activeLineId: this.activeLineId,
      nextId: _id,
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.lines = [];
    this.nodes.clear();
    this.segments = [];
    this.pendingPath = [];
    this.undoStack = [];
    this.clearGhost();
    resetIdCounter(data.nextId || 1);

    for (const n of data.nodes || []) {
      this.addNode(n.x, n.z, { id: n.id, station: n.station, lineIds: n.lineIds || [] });
    }
    for (const l of data.lines || []) {
      this.lines.push({
        id: l.id,
        name: l.name,
        color: l.color,
        frequency: l.frequency || 'mid',
        nodeIds: [...(l.nodeIds || [])],
        stationIds: [...(l.stationIds || [])],
      });
    }
    for (const s of data.segments || []) {
      this.segments.push({
        id: s.id,
        lineId: s.lineId,
        a: s.a,
        b: s.b,
        method: s.method,
        time: s.time || 0,
        difficulty: s.difficulty || 0,
        load: 0,
        capacity: 80,
        congestion: 0,
      });
    }
    this.activeLineId = data.activeLineId || this.lines[0]?.id || null;
  }

  /**
   * 绘制路网到 canvas（已处于屏幕像素坐标变换中：调用方传入 worldToScreen）
   */
  draw(ctx, toScreen, zoom, time = 0) {
    // 路段
    for (const seg of this.segments) {
      const a = this.nodes.get(seg.a);
      const b = this.nodes.get(seg.b);
      if (!a || !b) continue;
      const line = this.getLine(seg.lineId);
      let col = line?.color || '#ffffff';
      const cong = seg.congestion || 0;
      if (cong >= 0.85) col = '#ff4040';
      else if (cong >= 0.65) col = '#f0a020';
      else if (cong >= 0.35) col = '#d0e040';
      else if (cong > 0.05) col = '#2ee06a';

      const pa = toScreen(a.x, a.z);
      const pb = toScreen(b.x, b.z);
      const lw = Math.max(3, 4.5 * (zoom / 8));

      // 外发光
      ctx.strokeStyle = col;
      ctx.globalAlpha = cong >= 0.85 ? 0.35 + 0.25 * Math.sin(time * 8) : 0.35;
      ctx.lineWidth = lw + 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.stroke();

      // 主线
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.stroke();

      // 工法细条（虚线风格区分）
      if (seg.method === 'bridge' || seg.method === 'mountain_tunnel' || seg.method === 'shield') {
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = Math.max(1, lw * 0.35);
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 幽灵预览
    if (this.ghost) {
      const g = this.ghost;
      if (g.fromX != null) {
        const pa = toScreen(g.fromX, g.fromZ);
        const pb = toScreen(g.x, g.z);
        ctx.strokeStyle = g.color;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = Math.max(3, 4 * (zoom / 8));
        ctx.setLineDash([8, 6]);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      const p = toScreen(g.x, g.z);
      // 吸附黄圈
      if (g.snapped) {
        ctx.strokeStyle = '#ffe080';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = g.blocked ? '#ff5050' : g.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 节点
    for (const n of this.nodes.values()) {
      const p = toScreen(n.x, n.z);
      if (n.station) {
        const r = (7 + Math.min(6, (n.visualScale - 1) * 4)) * Math.min(1.2, zoom / 7);
        // 脉冲
        if (n.visualScale > 1.3) {
          ctx.strokeStyle = 'rgba(168,216,255,0.45)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, r + 4 + Math.sin(time * 3) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = n.highlight ? '#ffe080' : '#ffffff';
        ctx.strokeStyle = n.highlight ? '#ffc040' : '#3a90d8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // 换乘标记：多线
        if (n.lineIds.size > 1) {
          ctx.fillStyle = '#1a3050';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('换', p.sx, p.sy);
        }
      } else {
        const r = 4 * Math.min(1.2, zoom / 7);
        ctx.fillStyle = n.highlight ? '#ffe080' : '#e8f4ff';
        ctx.strokeStyle = n.highlight ? '#ffc040' : 'rgba(100,160,220,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}
