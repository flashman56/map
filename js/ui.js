/**
 * HUD 更新与中文界面绑定（2D 俯视）
 */
import { METHODS, normalizeBar } from './construction.js';

const METHOD_HINTS = Object.fromEntries(Object.values(METHODS).map((m) => [m.id, m.hint]));

export class UI {
  constructor(game) {
    this.game = game;
    this.toastTimer = null;
    this._ridershipHistory = [];
    this._chartAccum = 0;
    this.bind();
  }

  bind() {
    const g = this.game;

    document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        g.setTool(btn.dataset.tool);
        document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateBuildHints();
      });
    });

    document.getElementById('btn-new-line').addEventListener('click', () => {
      const color = document.getElementById('line-color').value;
      g.newLine(color);
    });

    document.getElementById('line-select').addEventListener('change', (e) => {
      g.selectLine(e.target.value);
    });

    document.getElementById('line-color').addEventListener('input', (e) => {
      g.setActiveLineColor(e.target.value);
    });

    document.getElementById('method-select').addEventListener('change', (e) => {
      g.method = e.target.value;
      document.getElementById('method-hint').textContent = METHOD_HINTS[g.method] || '';
      this.hidePreview();
    });

    document.getElementById('snap-nodes').addEventListener('change', (e) => {
      g.snapNodes = e.target.checked;
    });

    const gridSnap = document.getElementById('grid-snap');
    if (gridSnap) {
      gridSnap.addEventListener('change', (e) => {
        g.gridSnap = e.target.checked;
      });
    }

    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => g.undoTrack());
    }

    document.getElementById('btn-peak').addEventListener('click', () => {
      g.togglePeak();
      document.getElementById('btn-peak').textContent = g.passenger.peak ? '时段：高峰' : '时段：平峰';
    });

    document.getElementById('btn-sim').addEventListener('click', () => {
      g.toggleSim();
      document.getElementById('btn-sim').textContent = g.passenger.enabled ? '模拟：开' : '模拟：关';
    });

    document.getElementById('btn-save').addEventListener('click', () => g.save());
    document.getElementById('btn-load').addEventListener('click', () => g.load());

    const help = document.getElementById('help-modal');
    document.getElementById('btn-help').addEventListener('click', () => help.classList.add('open'));
    document.getElementById('help-close').addEventListener('click', () => help.classList.remove('open'));
    help.addEventListener('click', (e) => {
      if (e.target === help) help.classList.remove('open');
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        g.network.cancelPending();
        this.hidePreview();
        help.classList.remove('open');
        this.toast('已结束当前折线');
      }
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'z' || e.key === 'Z' || ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z'))) {
        e.preventDefault();
        g.undoTrack();
      }
      if (e.key === '1') this._setToolBtn('select');
      if (e.key === '2') this._setToolBtn('track');
      if (e.key === '3') this._setToolBtn('station');
      if (e.key === '4') this._setToolBtn('erase');
    });

    this.updateBuildHints();
  }

  _setToolBtn(tool) {
    const btn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (btn) btn.click();
  }

  updateBuildHints() {
    const el = document.getElementById('build-hint');
    if (!el) return;
    const t = this.game.tool;
    const map = {
      select: '浏览：左键拖拽平移 · 滚轮缩放 · 右键亦可平移',
      track: '铺轨：单击落点 · 黄圈=吸附 · Z撤销 · Esc结束',
      station: '设站：点击靠近轨道的节点',
      erase: '橡皮：点击节点删除',
    };
    el.textContent = map[t] || '';
  }

  refreshLineList() {
    const list = document.getElementById('line-list');
    const select = document.getElementById('line-select');
    const lines = this.game.network.lines;
    const active = this.game.network.activeLineId;

    select.innerHTML = '';
    list.innerHTML = '';

    for (const line of lines) {
      const opt = document.createElement('option');
      opt.value = line.id;
      opt.textContent = line.name;
      if (line.id === active) opt.selected = true;
      select.appendChild(opt);

      const row = document.createElement('div');
      row.className = 'line-item' + (line.id === active ? ' active' : '');
      row.innerHTML = `
        <span class="line-swatch" style="background:${line.color};color:${line.color}"></span>
        <span>${line.name}</span>
        <span class="freq-btns">
          <button data-f="low" class="${line.frequency === 'low' ? 'on' : ''}">低</button>
          <button data-f="mid" class="${line.frequency === 'mid' ? 'on' : ''}">中</button>
          <button data-f="high" class="${line.frequency === 'high' ? 'on' : ''}">高</button>
        </span>`;
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        this.game.selectLine(line.id);
      });
      row.querySelectorAll('button[data-f]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.game.setFrequency(line.id, btn.dataset.f);
        });
      });
      list.appendChild(row);
    }

    if (active) {
      const L = this.game.network.getLine(active);
      if (L) document.getElementById('line-color').value = L.color;
    }
  }

  refreshStats() {
    const s = this.game.passenger.stats;
    const net = this.game.network;
    document.getElementById('stat-ridership').textContent = String(s.ridership);
    document.getElementById('stat-transfers').textContent = String(s.avgTransfers);
    document.getElementById('stat-stations').textContent = String(net.getStations().length);
    document.getElementById('stat-segments').textContent = String(net.segments.length);
    document.getElementById('stat-worst').textContent = s.worstSegment;
    document.getElementById('stat-growth').textContent = `${s.growthPct}%`;

    const worstEl = document.getElementById('stat-worst');
    if (worstEl) {
      const m = /(\d+)%/.exec(s.worstSegment || '');
      const pct = m ? Number(m[1]) : 0;
      worstEl.style.color = pct >= 85 ? '#ff6a6a' : pct >= 50 ? '#ffd060' : '#a8d0ff';
    }
  }

  updateRidershipChart() {
    const canvas = document.getElementById('ride-chart');
    if (!canvas) return;
    this._chartAccum += 1;
    if (this._chartAccum < 8) return;
    this._chartAccum = 0;

    const r = this.game.passenger.stats.ridership || 0;
    this._ridershipHistory.push(r);
    if (this._ridershipHistory.length > 48) this._ridershipHistory.shift();

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(12, 22, 42, 0.9)';
    ctx.fillRect(0, 0, w, h);

    const hist = this._ridershipHistory;
    const max = Math.max(10, ...hist);
    ctx.strokeStyle = '#5aa8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    hist.forEach((v, i) => {
      const x = (i / Math.max(1, hist.length - 1)) * (w - 4) + 2;
      const y = h - 4 - (v / max) * (h - 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (hist.length > 1) {
      ctx.lineTo(w - 2, h - 2);
      ctx.lineTo(2, h - 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(60, 140, 255, 0.18)';
      ctx.fill();
    }

    ctx.fillStyle = '#8eb8e8';
    ctx.font = '10px sans-serif';
    ctx.fillText('客运趋势', 6, 12);
  }

  showPreview(ev, methodId) {
    const box = document.getElementById('build-preview');
    if (!ev) {
      box.classList.remove('visible');
      return;
    }
    box.classList.add('visible');
    const m = METHODS[methodId];
    document.getElementById('preview-title').textContent =
      `施工预览 · ${m?.name || methodId} · 长度 ${ev.length?.toFixed?.(1) ?? '—'} `;
    document.getElementById('bar-time').style.width = `${normalizeBar(ev.time)}%`;
    document.getElementById('bar-diff').style.width = `${normalizeBar(ev.difficulty)}%`;
    document.getElementById('val-time').textContent = `${ev.time}`;
    document.getElementById('val-diff').textContent = `${ev.difficulty}`;
    const msg = document.getElementById('preview-msg');
    msg.textContent = ev.message || '';
    msg.className = ev.blocked ? 'warn' : ev.ok === false ? 'warn' : 'ok';
    box.classList.toggle('blocked', !!ev.blocked);
  }

  hidePreview() {
    document.getElementById('build-preview').classList.remove('visible', 'blocked');
  }

  toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    el.classList.toggle('danger', text.includes('拥挤') || text.includes('⚠'));
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show', 'danger'), 2600);
  }

  drawMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a1220';
    ctx.fillRect(0, 0, w, h);

    const map = (x, z) => ({
      px: ((x + 60) / 120) * w,
      py: ((z + 60) / 120) * h,
    });

    // 河
    ctx.strokeStyle = '#3a78c8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = -60; x <= 60; x += 4) {
      const z = Math.sin(x * 0.06) * 8 + 4;
      const p = map(x, z);
      if (x === -60) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    }
    ctx.stroke();

    // 设施点
    const hubs = [
      [42, -38], [-4, 38], [2, 8], [-28, 2], [36, 6],
    ];
    ctx.fillStyle = 'rgba(200,220,240,0.35)';
    for (const [x, z] of hubs) {
      const p = map(x, z);
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const net = this.game.network;
    for (const s of net.segments) {
      const a = net.nodes.get(s.a);
      const b = net.nodes.get(s.b);
      if (!a || !b) continue;
      const line = net.getLine(s.lineId);
      let col = line?.color || '#fff';
      if (s.congestion >= 0.85) col = '#ff4040';
      else if (s.congestion >= 0.65) col = '#f0a020';
      else if (s.congestion >= 0.35) col = '#d0e040';
      else if (s.congestion > 0.05) col = '#2ee06a';
      const pa = map(a.x, a.z);
      const pb = map(b.x, b.z);
      ctx.strokeStyle = col;
      ctx.lineWidth = s.congestion >= 0.85 ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.moveTo(pa.px, pa.py);
      ctx.lineTo(pb.px, pb.py);
      ctx.stroke();
    }

    for (const st of net.getStations()) {
      const p = map(st.x, st.z);
      const boarding = this.game.passenger.stationBoardings.get(st.id) || 0;
      const r = 2.5 + Math.min(4, boarding / 40);
      ctx.fillStyle = boarding > 80 ? '#ff8080' : boarding > 40 ? '#ffe080' : '#e8f4ff';
      ctx.beginPath();
      ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 视口框
    const cam = this.game.cam;
    const vw = this.game.viewW / cam.zoom;
    const vh = this.game.viewH / cam.zoom;
    const tl = map(cam.x - vw / 2, cam.z - vh / 2);
    const br = map(cam.x + vw / 2, cam.z + vh / 2);
    ctx.strokeStyle = 'rgba(255,220,120,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.px, tl.py, br.px - tl.px, br.py - tl.py);
  }
}
