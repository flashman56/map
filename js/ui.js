/**
 * HUD 更新与中文界面绑定
 */
import { METHODS, normalizeBar } from './construction.js';

const METHOD_HINTS = Object.fromEntries(Object.values(METHODS).map((m) => [m.id, m.hint]));

export class UI {
  constructor(game) {
    this.game = game;
    this.toastTimer = null;
    this.bind();
  }

  bind() {
    const g = this.game;

    document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        g.setTool(btn.dataset.tool);
        document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
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

    document.getElementById('btn-peak').addEventListener('click', () => {
      g.togglePeak();
      document.getElementById('btn-peak').textContent = g.passenger.peak ? '时段：高峰' : '时段：平峰';
    });

    document.getElementById('btn-sim').addEventListener('click', () => {
      g.toggleSim();
      document.getElementById('btn-sim').textContent = g.passenger.enabled ? '模拟：开' : '模拟：关';
    });

    document.getElementById('btn-topdown').addEventListener('click', () => {
      g.toggleTopDown();
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
      }
    });
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
  }

  hidePreview() {
    document.getElementById('build-preview').classList.remove('visible');
  }

  toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  drawMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0c1424';
    ctx.fillRect(0, 0, w, h);

    const map = (x, z) => ({
      px: ((x + 60) / 120) * w,
      py: ((z + 60) / 120) * h,
    });

    // river hint
    ctx.strokeStyle = '#3a70c0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = -60; x <= 60; x += 4) {
      const z = Math.sin(x * 0.06) * 8 + 4;
      const p = map(x, z);
      if (x === -60) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    }
    ctx.stroke();

    const net = this.game.network;
    for (const s of net.segments) {
      const a = net.nodes.get(s.a);
      const b = net.nodes.get(s.b);
      if (!a || !b) continue;
      const line = net.getLine(s.lineId);
      let col = line?.color || '#fff';
      if (s.congestion >= 0.85) col = '#e04040';
      else if (s.congestion >= 0.5) col = '#e0c040';
      else if (s.congestion > 0.05) col = '#40d060';
      const pa = map(a.x, a.z);
      const pb = map(b.x, b.z);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(pa.px, pa.py);
      ctx.lineTo(pb.px, pb.py);
      ctx.stroke();
    }

    for (const st of net.getStations()) {
      const p = map(st.x, st.z);
      ctx.fillStyle = '#e8f4ff';
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
