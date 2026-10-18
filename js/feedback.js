/**
 * 客流体感（2D）：列车沿线路移动、站点客运数字、拥挤 Toast
 */
export class FeedbackFX {
  constructor(network, passenger, ui) {
    this.network = network;
    this.passenger = passenger;
    this.ui = ui;
    this.trains = []; // { segId, slot, t, speed, dir, color }
    this.prevCongestion = new Map();
    this._toastCooldown = 0;
    this._syncAccum = 0;
  }

  syncTrains() {
    const want = [];
    for (const seg of this.network.segments) {
      const load = seg.load || 0;
      const cong = seg.congestion || 0;
      let n = 0;
      if (load > 2) n = 1;
      if (load > 25 || cong > 0.4) n = 2;
      if (load > 60 || cong > 0.8) n = 3;
      for (let i = 0; i < n; i++) want.push({ segId: seg.id, slot: i, n });
    }

    const keep = new Set(want.map((w) => `${w.segId}:${w.slot}`));
    this.trains = this.trains.filter((t) => keep.has(`${t.segId}:${t.slot}`));

    const have = new Set(this.trains.map((t) => `${t.segId}:${t.slot}`));
    for (const w of want) {
      const k = `${w.segId}:${w.slot}`;
      if (have.has(k)) continue;
      const seg = this.network.segments.find((s) => s.id === w.segId);
      if (!seg) continue;
      const line = this.network.getLine(seg.lineId);
      this.trains.push({
        segId: w.segId,
        slot: w.slot,
        t: (w.slot + 0.15) / Math.max(1, w.n),
        speed: 0.18 + Math.min(0.22, (seg.load || 0) * 0.002),
        dir: w.slot % 2 === 0 ? 1 : -1,
        color: line?.color || '#ffffff',
      });
    }
  }

  checkCongestionToasts(dt) {
    this._toastCooldown = Math.max(0, this._toastCooldown - dt);
    if (this._toastCooldown > 0) return;
    for (const seg of this.network.segments) {
      const prev = this.prevCongestion.get(seg.id) || 0;
      const cur = seg.congestion || 0;
      this.prevCongestion.set(seg.id, cur);
      const line = this.network.getLine(seg.lineId);
      if (prev < 0.85 && cur >= 0.85) {
        this.ui.toast(`⚠ ${line?.name || '线路'} 路段拥挤，可提高发车频率`);
        this._toastCooldown = 4;
        return;
      }
      if (prev < 0.5 && cur >= 0.5 && cur < 0.85) {
        this.ui.toast(`${line?.name || '线路'} 路段偏满`);
        this._toastCooldown = 3.5;
        return;
      }
    }
  }

  update(dt) {
    this._syncAccum += dt;
    if (this._syncAccum > 0.6) {
      this._syncAccum = 0;
      this.syncTrains();
    }
    for (const t of this.trains) {
      const seg = this.network.segments.find((s) => s.id === t.segId);
      if (!seg) continue;
      const slow = 1 / (1 + (seg.congestion || 0) * 1.2);
      t.t += t.dir * t.speed * slow * dt;
      if (t.t > 1) {
        t.t = 1;
        t.dir = -1;
      } else if (t.t < 0) {
        t.t = 0;
        t.dir = 1;
      }
      const line = this.network.getLine(seg.lineId);
      if (line) t.color = line.color;
    }
    this.checkCongestionToasts(dt);
  }

  draw(ctx, toScreen, zoom) {
    // 列车
    for (const t of this.trains) {
      const seg = this.network.segments.find((s) => s.id === t.segId);
      if (!seg) continue;
      const pos = this.network.segmentLerp(seg, t.t);
      if (!pos) continue;
      const p = toScreen(pos.x, pos.z);
      const len = Math.max(10, 12 * (zoom / 8));
      const wid = Math.max(4, 5 * (zoom / 8));
      ctx.save();
      ctx.translate(p.sx, p.sy);
      ctx.rotate(pos.angle);
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(-len / 2, -wid / 2, len, wid);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-len / 2 + 2, -wid / 2 + 1, 3, wid - 2);
      ctx.restore();
    }

    // 站点客运数字
    for (const st of this.network.getStations()) {
      const boarding = this.passenger.stationBoardings.get(st.id) || 0;
      if (boarding < 0.5) continue;
      const p = toScreen(st.x, st.z);
      const shown = Math.round(boarding);
      let color = '#a8d8ff';
      if (boarding > 40) color = '#ffe080';
      if (boarding > 80) color = '#ff8080';
      const label = `+${shown}`;
      ctx.font = `bold ${Math.max(11, 12 * (zoom / 8))}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const tw = ctx.measureText(label).width + 10;
      const y = p.sy - 14 - Math.min(10, boarding * 0.05);
      const x0 = p.sx - tw / 2;
      const y0 = y - 16;
      ctx.fillStyle = 'rgba(8,16,32,0.75)';
      ctx.fillRect(x0, y0, tw, 18);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, tw - 1, 17);
      ctx.fillStyle = color;
      ctx.fillText(label, p.sx, y);
    }
  }
}
