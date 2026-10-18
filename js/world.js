/**
 * 世界地形与 2D 城市底图（架空城）
 * 坐标：x / z 平面（与存档兼容）；渲染为俯视 Canvas2D
 */
export const WORLD_SIZE = 120;
export const HALF = WORLD_SIZE / 2;

export const Geology = {
  NORMAL: 'normal',
  SOFT: 'soft',
  ROCK: 'rock',
  WATER: 'water',
  MOUNTAIN: 'mountain',
};

/** 城区/设施分区（仅视觉与需求加成，地质仍由 sampleGeology 决定） */
export const DISTRICTS = [
  { id: 'cbd', name: '中央商务区', x: 2, z: 8, r: 14, color: '#5a6278', demand: 1.2 },
  { id: 'residential', name: '西岸住宅区', x: -28, z: 2, r: 16, color: '#6a7a5a', demand: 1.0 },
  { id: 'industrial', name: '东港工业区', x: 36, z: 6, r: 14, color: '#7a6a58', demand: 0.85 },
  { id: 'university', name: '青岚大学', x: -18, z: -22, r: 10, color: '#5a7a88', demand: 0.9 },
  { id: 'stadium', name: '市立体育场', x: 18, z: -16, r: 8, color: '#6a5a78', demand: 0.7 },
  { id: 'hospital', name: '中心医院', x: -8, z: 22, r: 7, color: '#8a6a6a', demand: 0.75 },
  { id: 'airport', name: '空港', x: 42, z: -38, r: 12, color: '#5a6878', demand: 1.6 },
  { id: 'hsr', name: '高铁站', x: -4, z: 38, r: 9, color: '#586878', demand: 1.4 },
  { id: 'port', name: '滨江港区', x: -42, z: 28, r: 10, color: '#4a6880', demand: 0.8 },
  { id: 'park_n', name: '北湖公园', x: 8, z: -32, r: 11, color: '#3a7a48', demand: 0.35 },
  { id: 'park_w', name: '西苑公园', x: -38, z: -18, r: 9, color: '#3a7848', demand: 0.3 },
];

export function sampleGeology(x, z) {
  const riverZ = Math.sin(x * 0.06) * 8 + 4;
  if (Math.abs(z - riverZ) < 3.2) return Geology.WATER;
  // 支流 / 北湖水域
  if (Math.hypot(x - 8, z + 32) < 7.5) return Geology.WATER;
  // 港口侧开阔水面
  if (x < -48 && z > 18 && z < 42) return Geology.WATER;

  const m1 = Math.hypot(x + 28, z + 22);
  if (m1 < 18) return Geology.MOUNTAIN;
  const m2 = Math.hypot(x - 32, z - 28);
  if (m2 < 14) return Geology.MOUNTAIN;
  // 机场北侧小山丘
  const m3 = Math.hypot(x - 48, z + 18);
  if (m3 < 8) return Geology.MOUNTAIN;

  if (Math.abs(z - riverZ) < 10) return Geology.SOFT;
  if (x > 20 && z > -10 && z < 25 && Math.hypot(x - 35, z - 5) < 16) return Geology.SOFT;

  if (m1 < 26 || m2 < 20 || m3 < 12) return Geology.ROCK;
  return Geology.NORMAL;
}

export function sampleHeight(x, z) {
  let h = 0;
  const m1 = Math.hypot(x + 28, z + 22);
  if (m1 < 22) h = Math.max(h, (1 - m1 / 22) ** 1.4 * 14);
  const m2 = Math.hypot(x - 32, z - 28);
  if (m2 < 18) h = Math.max(h, (1 - m2 / 18) ** 1.4 * 11);
  const m3 = Math.hypot(x - 48, z + 18);
  if (m3 < 10) h = Math.max(h, (1 - m3 / 10) ** 1.4 * 7);
  return h;
}

export function sampleUrbanDensity(x, z) {
  const geo = sampleGeology(x, z);
  if (geo === Geology.WATER || geo === Geology.MOUNTAIN) return 0;
  let d = 0;
  for (const dist of DISTRICTS) {
    if (dist.id.startsWith('park')) continue;
    const t = Math.max(0, 1 - Math.hypot(x - dist.x, z - dist.z) / dist.r);
    const weight =
      dist.id === 'cbd' ? 1 :
      dist.id === 'residential' || dist.id === 'industrial' ? 0.8 :
      dist.id === 'airport' || dist.id === 'hsr' ? 0.55 : 0.65;
    d = Math.max(d, t * weight);
  }
  return Math.min(1, d);
}

export function createDemandGrid(resolution = 24) {
  const cells = [];
  const step = WORLD_SIZE / resolution;
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const x = -HALF + (i + 0.5) * step;
      const z = -HALF + (j + 0.5) * step;
      const geo = sampleGeology(x, z);
      if (geo === Geology.WATER || geo === Geology.MOUNTAIN) continue;
      const urban = sampleUrbanDensity(x, z);
      let hub = 0;
      for (const dist of DISTRICTS) {
        const t = Math.max(0, 1 - Math.hypot(x - dist.x, z - dist.z) / (dist.r * 0.85));
        hub = Math.max(hub, t * (dist.demand || 0.5) * 18);
      }
      const base = urban * 12 + hub + 1.5;
      cells.push({
        x, z, i, j,
        baseDemand: base,
        demand: base,
        growth: 1,
        covered: false,
      });
    }
  }
  return { cells, step, resolution };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function hexCss(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** 采样地面色（示意/地铁图式） */
export function sampleGroundColor(x, z) {
  const riverZ = Math.sin(x * 0.06) * 8 + 4;
  const riverDist = Math.abs(z - riverZ);
  const m1 = Math.hypot(x + 28, z + 22);
  const m2 = Math.hypot(x - 32, z - 28);
  const m3 = Math.hypot(x - 48, z + 18);
  const lake = Math.hypot(x - 8, z + 32);
  const portWater = x < -48 && z > 18 && z < 42 ? 1 : 0;

  const water = Math.max(
    1 - smoothstep(2.2, 3.8, riverDist),
    1 - smoothstep(5.5, 8, lake),
    portWater
  );
  const soft = Math.min(1, (1 - smoothstep(5.5, 11.5, riverDist)) * (1 - water) * 0.9);
  const mountain = Math.max(
    1 - smoothstep(12, 19, m1),
    1 - smoothstep(9, 15, m2),
    1 - smoothstep(5, 9, m3)
  );
  const rock = Math.max(
    (1 - smoothstep(18, 27, m1)) * (1 - mountain),
    (1 - smoothstep(14, 21, m2)) * (1 - mountain)
  );
  const urban = sampleUrbanDensity(x, z);

  let c = 0x4a7a48; // plain
  c = lerpColor(c, 0xc4a86a, soft * 0.9);
  c = lerpColor(c, 0x6e6e72, rock * 0.75);
  c = lerpColor(c, 0x8a7a5a, mountain * 0.92);
  c = lerpColor(c, 0x2a568c, water * 0.95);
  if (urban > 0.12 && water < 0.35 && mountain < 0.35) {
    c = lerpColor(c, 0x4e5566, urban * 0.62);
  }
  // parks
  for (const dist of DISTRICTS) {
    if (!dist.id.startsWith('park')) continue;
    const t = Math.max(0, 1 - Math.hypot(x - dist.x, z - dist.z) / dist.r);
    if (t > 0 && water < 0.4) c = lerpColor(c, 0x3a8a4a, t * 0.7);
  }
  const n = Math.sin(x * 0.31 + z * 0.27) * Math.cos(x * 0.17 - z * 0.23);
  if (n > 0.3) c = lerpColor(c, 0x3f7240, 0.08);
  return hexCss(c);
}

/**
 * 预渲染城市底图到离屏 canvas（像素网格）
 * @returns {HTMLCanvasElement}
 */
export function bakeCityBase(pixelSize = 720) {
  const canvas = document.createElement('canvas');
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(pixelSize, pixelSize);
  const data = img.data;
  for (let py = 0; py < pixelSize; py++) {
    for (let px = 0; px < pixelSize; px++) {
      const x = -HALF + ((px + 0.5) / pixelSize) * WORLD_SIZE;
      const z = -HALF + ((py + 0.5) / pixelSize) * WORLD_SIZE;
      const css = sampleGroundColor(x, z);
      const r = parseInt(css.slice(1, 3), 16);
      const g = parseInt(css.slice(3, 5), 16);
      const b = parseInt(css.slice(5, 7), 16);
      const i = (py * pixelSize + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 分区淡色晕染
  for (const dist of DISTRICTS) {
    const sx = ((dist.x + HALF) / WORLD_SIZE) * pixelSize;
    const sy = ((dist.z + HALF) / WORLD_SIZE) * pixelSize;
    const sr = (dist.r / WORLD_SIZE) * pixelSize;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    grad.addColorStop(0, `${dist.color}55`);
    grad.addColorStop(0.55, `${dist.color}22`);
    grad.addColorStop(1, `${dist.color}00`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // 主河高光带
  ctx.strokeStyle = 'rgba(120,180,255,0.35)';
  ctx.lineWidth = Math.max(2, pixelSize / 180);
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const x = -HALF + (i / 60) * WORLD_SIZE;
    const z = Math.sin(x * 0.06) * 8 + 4;
    const sx = ((x + HALF) / WORLD_SIZE) * pixelSize;
    const sy = ((z + HALF) / WORLD_SIZE) * pixelSize;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  // 装饰道路网（淡）
  ctx.strokeStyle = 'rgba(220,230,240,0.12)';
  ctx.lineWidth = 1;
  for (let g = -50; g <= 50; g += 10) {
    ctx.beginPath();
    ctx.moveTo(((g + HALF) / WORLD_SIZE) * pixelSize, 0);
    ctx.lineTo(((g + HALF) / WORLD_SIZE) * pixelSize, pixelSize);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, ((g + HALF) / WORLD_SIZE) * pixelSize);
    ctx.lineTo(pixelSize, ((g + HALF) / WORLD_SIZE) * pixelSize);
    ctx.stroke();
  }

  // 设施图标与中文标注
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const dist of DISTRICTS) {
    const sx = ((dist.x + HALF) / WORLD_SIZE) * pixelSize;
    const sy = ((dist.z + HALF) / WORLD_SIZE) * pixelSize;
    const icon = facilityIcon(dist.id);
    // 底板
    ctx.fillStyle = 'rgba(8,16,32,0.55)';
    const tw = ctx.measureText(dist.name).width || 40;
    const pad = 8;
    roundRect(ctx, sx - tw / 2 - pad, sy + 10, tw + pad * 2, 18, 6);
    ctx.fill();
    // 图标圆
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.arc(sx, sy - 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a3050';
    ctx.font = `bold ${Math.max(11, pixelSize / 60)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(icon, sx, sy - 1);
    ctx.fillStyle = '#f0f6ff';
    ctx.font = `600 ${Math.max(11, pixelSize / 65)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillText(dist.name, sx, sy + 19);
  }

  // 地图边框标题
  ctx.fillStyle = 'rgba(240,248,255,0.75)';
  ctx.font = `600 ${Math.max(14, pixelSize / 40)}px "PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('青岚市 · 示意平面图', 16, 22);

  return canvas;
}

function facilityIcon(id) {
  const map = {
    cbd: '🏙',
    residential: '🏠',
    industrial: '🏭',
    university: '🎓',
    stadium: '🏟️',
    hospital: '🏥',
    airport: '✈',
    hsr: '🚄',
    port: '⚓',
    park_n: '🌳',
    park_w: '🌳',
  };
  return map[id] || '●';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 绘制城市底图（世界坐标 → 屏幕由调用方变换） */
export function drawCityLayers(ctx, baseCanvas, cam, viewW, viewH) {
  // cam: { x, z, zoom } 世界中心与像素/世界单位
  const scale = cam.zoom;
  const ox = viewW / 2 - cam.x * scale;
  const oz = viewH / 2 - cam.z * scale;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a1424';
  ctx.fillRect(0, 0, viewW, viewH);

  // 底图
  const left = ox - HALF * scale;
  const top = oz - HALF * scale;
  const size = WORLD_SIZE * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baseCanvas, left, top, size, size);

  // 地图外暗边
  ctx.strokeStyle = 'rgba(160,190,240,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(left, top, size, size);

  ctx.restore();
  return { ox, oz, scale };
}

export function worldToScreen(x, z, cam, viewW, viewH) {
  return {
    sx: viewW / 2 + (x - cam.x) * cam.zoom,
    sy: viewH / 2 + (z - cam.z) * cam.zoom,
  };
}

export function screenToWorld(sx, sy, cam, viewW, viewH) {
  return {
    x: cam.x + (sx - viewW / 2) / cam.zoom,
    z: cam.z + (sy - viewH / 2) / cam.zoom,
  };
}
