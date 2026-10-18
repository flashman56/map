/**
 * 客流体感反馈：列车动画、站点弹字、拥堵脉冲、拥挤 Toast
 */
import * as THREE from 'three';

function makeLabelSprite(text, color = '#e8f4ff') {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = 'bold 28px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,16,32,0.72)';
  const tw = Math.min(120, ctx.measureText(text).width + 16);
  const x0 = 64 - tw / 2;
  ctx.fillRect(x0, 14, tw, 36);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.2, 1.6, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function updateLabelSprite(sprite, text, color) {
  const canvas = sprite.material.map.image;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = 'bold 28px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,16,32,0.75)';
  const tw = Math.min(120, ctx.measureText(text).width + 18);
  const x0 = 64 - tw / 2;
  ctx.fillRect(x0, 14, tw, 36);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, 15, tw - 2, 34);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 3;
  ctx.fillText(text, 64, 32);
  sprite.material.map.needsUpdate = true;
}

export class FeedbackFX {
  constructor(network, passenger, ui) {
    this.network = network;
    this.passenger = passenger;
    this.ui = ui;
    this.group = new THREE.Group();
    this.group.name = 'feedback';
    network.scene.add(this.group);

    this.trains = []; // { mesh, segId, t, speed, dir }
    this.labels = new Map(); // stationId -> sprite
    this.pulses = new Map(); // stationId -> mesh
    this.prevCongestion = new Map();
    this._toastCooldown = 0;
    this._trainMatCache = new Map();
  }

  _trainMat(hex) {
    const key = hex.toString(16);
    if (!this._trainMatCache.has(key)) {
      this._trainMatCache.set(
        key,
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.85,
          roughness: 0.35,
          metalness: 0.45,
        })
      );
    }
    return this._trainMatCache.get(key);
  }

  _curveForSeg(seg) {
    const a = this.network.nodes.get(seg.a);
    const b = this.network.nodes.get(seg.b);
    if (!a || !b) return null;
    const pts = this.network._segmentPoints(a, b, seg.method);
    return new THREE.CatmullRomCurve3(pts);
  }

  syncTrains() {
    const want = [];
    for (const seg of this.network.segments) {
      const load = seg.load || 0;
      const cong = seg.congestion || 0;
      // 0~3 trains based on load / congestion
      let n = 0;
      if (load > 2) n = 1;
      if (load > 25 || cong > 0.4) n = 2;
      if (load > 60 || cong > 0.8) n = 3;
      for (let i = 0; i < n; i++) {
        want.push({ segId: seg.id, slot: i, n });
      }
    }

    // Remove orphaned
    const keep = new Set(want.map((w) => `${w.segId}:${w.slot}`));
    this.trains = this.trains.filter((t) => {
      const k = `${t.segId}:${t.slot}`;
      if (!keep.has(k)) {
        this.group.remove(t.mesh);
        t.mesh.geometry?.dispose?.();
        return false;
      }
      return true;
    });

    const have = new Set(this.trains.map((t) => `${t.segId}:${t.slot}`));
    for (const w of want) {
      const k = `${w.segId}:${w.slot}`;
      if (have.has(k)) continue;
      const seg = this.network.segments.find((s) => s.id === w.segId);
      if (!seg) continue;
      const line = this.network.getLine(seg.lineId);
      const col = new THREE.Color(line?.color || '#ffffff');
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.32, 1.1),
        this._trainMat(col.getHex())
      );
      mesh.castShadow = true;
      this.group.add(mesh);
      this.trains.push({
        mesh,
        segId: w.segId,
        slot: w.slot,
        t: (w.slot + 0.15) / Math.max(1, w.n),
        speed: 0.12 + Math.min(0.18, (seg.load || 0) * 0.0015),
        dir: w.slot % 2 === 0 ? 1 : -1,
      });
    }
  }

  syncStationLabels() {
    const stations = this.network.getStations();
    const live = new Set(stations.map((s) => s.id));
    for (const [id, sprite] of this.labels) {
      if (!live.has(id)) {
        this.group.remove(sprite);
        sprite.material.map?.dispose?.();
        sprite.material.dispose();
        this.labels.delete(id);
      }
    }
    for (const [id, pulse] of this.pulses) {
      if (!live.has(id)) {
        this.group.remove(pulse);
        pulse.geometry?.dispose?.();
        pulse.material?.dispose?.();
        this.pulses.delete(id);
      }
    }

    for (const st of stations) {
      const boarding = this.passenger.stationBoardings.get(st.id) || 0;
      const shown = Math.round(boarding);
      if (!this.labels.has(st.id)) {
        const spr = makeLabelSprite(String(shown));
        this.group.add(spr);
        this.labels.set(st.id, spr);
      }
      const spr = this.labels.get(st.id);
      let color = '#a8d8ff';
      if (boarding > 40) color = '#ffe080';
      if (boarding > 80) color = '#ff8080';
      updateLabelSprite(spr, shown > 0 ? `+${shown}` : '0', color);
      spr.position.set(st.x, st.y + 2.4 + Math.min(1.5, boarding * 0.01), st.z);
      spr.visible = boarding > 0.5;
      spr.scale.setScalar(0.9 + Math.min(0.6, boarding / 100));

      // Pulse ring under busy stations
      if (!this.pulses.has(st.id)) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.2, 1.55, 32),
          new THREE.MeshBasicMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        ring.rotation.x = -Math.PI / 2;
        this.group.add(ring);
        this.pulses.set(st.id, ring);
      }
      const pulse = this.pulses.get(st.id);
      pulse.position.set(st.x, 0.08, st.z);
      const busy = Math.min(1, boarding / 90);
      pulse.visible = busy > 0.08;
      pulse.material.opacity = 0.15 + busy * 0.45;
      const hueCol =
        boarding > 80 ? 0xff6060 : boarding > 40 ? 0xffd060 : 0x68c0ff;
      pulse.material.color.setHex(hueCol);
    }
  }

  checkCrowdingToasts(dt) {
    this._toastCooldown = Math.max(0, this._toastCooldown - dt);
    for (const seg of this.network.segments) {
      const prev = this.prevCongestion.get(seg.id) || 0;
      const cur = seg.congestion || 0;
      this.prevCongestion.set(seg.id, cur);
      if (this._toastCooldown > 0) continue;
      if (prev < 0.85 && cur >= 0.85) {
        const line = this.network.getLine(seg.lineId);
        this.ui?.toast?.(
          `⚠ ${line?.name || '线路'} 路段拥挤 ${(cur * 100).toFixed(0)}% · 可提高发车频率`
        );
        this._toastCooldown = 4.5;
        // Flash glow
        if (seg.glow?.material) {
          const old = seg.glow.material.opacity;
          seg.glow.material.opacity = 0.85;
          setTimeout(() => {
            if (seg.glow?.material) seg.glow.material.opacity = old;
          }, 600);
        }
      } else if (prev < 0.5 && cur >= 0.5 && cur < 0.85) {
        const line = this.network.getLine(seg.lineId);
        this.ui?.toast?.(`${line?.name || '线路'} 开始偏满 ${(cur * 100).toFixed(0)}%`);
        this._toastCooldown = 3.5;
      }
    }
    // prune removed segs
    for (const id of [...this.prevCongestion.keys()]) {
      if (!this.network.segments.find((s) => s.id === id)) this.prevCongestion.delete(id);
    }
  }

  update(dt, time) {
    if (!this.passenger.enabled) {
      for (const t of this.trains) t.mesh.visible = false;
      for (const spr of this.labels.values()) spr.visible = false;
      for (const p of this.pulses.values()) p.visible = false;
      return;
    }

    this.syncTrains();
    this.syncStationLabels();
    this.checkCrowdingToasts(dt);

    // Move trains
    for (const t of this.trains) {
      const seg = this.network.segments.find((s) => s.id === t.segId);
      if (!seg) {
        t.mesh.visible = false;
        continue;
      }
      t.mesh.visible = true;
      const curve = this._curveForSeg(seg);
      if (!curve) continue;
      const cong = seg.congestion || 0;
      const speedMul = cong > 0.85 ? 0.45 : cong > 0.5 ? 0.7 : 1;
      t.t += dt * t.speed * speedMul * t.dir;
      if (t.t > 1) {
        t.t = 1;
        t.dir = -1;
      } else if (t.t < 0) {
        t.t = 0;
        t.dir = 1;
      }
      const p = curve.getPoint(t.t);
      const p2 = curve.getPoint(Math.min(1, Math.max(0, t.t + 0.02 * t.dir)));
      t.mesh.position.copy(p);
      t.mesh.position.y += 0.25;
      t.mesh.lookAt(p2.x, p2.y + 0.25, p2.z);
      // Congestion tint
      if (cong > 0.5) {
        t.mesh.material.emissiveIntensity = 0.85 + Math.sin(time * 8) * 0.25 * Math.min(1, cong);
      } else {
        t.mesh.material.emissiveIntensity = 0.75;
      }
    }

    // Pulse animate
    for (const [id, pulse] of this.pulses) {
      if (!pulse.visible) continue;
      const boarding = this.passenger.stationBoardings.get(id) || 0;
      const base = 1.2 + Math.min(1.2, boarding / 60);
      const s = base + Math.sin(time * (2.5 + Math.min(4, boarding / 30))) * 0.18;
      pulse.scale.set(s, s, 1);
    }

    // Segment congestion pulse on tube glow
    for (const seg of this.network.segments) {
      if (!seg.glow?.material) continue;
      const c = seg.congestion || 0;
      if (c >= 0.85) {
        seg.glow.material.opacity = 0.35 + Math.sin(time * 6) * 0.25;
      }
    }
  }

  dispose() {
    for (const t of this.trains) {
      this.group.remove(t.mesh);
      t.mesh.geometry?.dispose?.();
    }
    this.trains = [];
    for (const spr of this.labels.values()) {
      this.group.remove(spr);
      spr.material.map?.dispose?.();
      spr.material.dispose();
    }
    this.labels.clear();
    for (const p of this.pulses.values()) {
      this.group.remove(p);
      p.geometry?.dispose?.();
      p.material?.dispose?.();
    }
    this.pulses.clear();
    this.network.scene.remove(this.group);
  }
}
