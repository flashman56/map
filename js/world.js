/**
 * 世界地形：平原、山脉、河流、地质分区、城区密度块
 */
import * as THREE from 'three';

export const WORLD_SIZE = 120;
export const HALF = WORLD_SIZE / 2;

/** 地质类型 */
export const Geology = {
  NORMAL: 'normal',
  SOFT: 'soft',
  ROCK: 'rock',
  WATER: 'water',
  MOUNTAIN: 'mountain',
};

/** 采样点世界坐标 → 地质 */
export function sampleGeology(x, z) {
  // 河流：沿 x 轴弯曲的带状水域
  const riverZ = Math.sin(x * 0.06) * 8 + 4;
  if (Math.abs(z - riverZ) < 3.2) return Geology.WATER;

  // 山脉：西北与东南两座
  const m1 = Math.hypot(x + 28, z + 22);
  if (m1 < 18) return Geology.MOUNTAIN;
  const m2 = Math.hypot(x - 32, z - 28);
  if (m2 < 14) return Geology.MOUNTAIN;

  // 软土：河岸附近与东部洼地
  if (Math.abs(z - riverZ) < 10) return Geology.SOFT;
  if (x > 20 && z > -10 && z < 25 && Math.hypot(x - 35, z - 5) < 16) return Geology.SOFT;

  // 硬岩：山地外围
  if (m1 < 26 || m2 < 20) return Geology.ROCK;

  return Geology.NORMAL;
}

/** 山地高度（0 = 平地） */
export function sampleHeight(x, z) {
  let h = 0;
  const m1 = Math.hypot(x + 28, z + 22);
  if (m1 < 22) h = Math.max(h, (1 - m1 / 22) ** 1.4 * 14);
  const m2 = Math.hypot(x - 32, z - 28);
  if (m2 < 18) h = Math.max(h, (1 - m2 / 18) ** 1.4 * 11);
  return h;
}

/** 城区密度 0~1（中心偏南为市中心） */
export function sampleUrbanDensity(x, z) {
  const geo = sampleGeology(x, z);
  if (geo === Geology.WATER || geo === Geology.MOUNTAIN) return 0;
  const dCenter = Math.hypot(x - 2, z + 8);
  let d = Math.max(0, 1 - dCenter / 28);
  // 住宅区偏西，商务偏东
  const dWest = Math.hypot(x + 18, z + 5);
  d = Math.max(d, Math.max(0, 1 - dWest / 16) * 0.75);
  const dEast = Math.hypot(x - 16, z + 12);
  d = Math.max(d, Math.max(0, 1 - dEast / 14) * 0.85);
  return Math.min(1, d);
}

/** 出行需求强度（受城市发展倍率影响） */
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
      // 枢纽：机场（东北）、火车站（南）
      const hubAirport = Math.max(0, 1 - Math.hypot(x - 40, z + 40) / 10) * 1.8;
      const hubStation = Math.max(0, 1 - Math.hypot(x + 5, z - 35) / 8) * 1.5;
      const base = urban * 12 + hubAirport * 20 + hubStation * 18 + 1.5;
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

export function createWorldGroup(scene) {
  const group = new THREE.Group();
  group.name = 'world';

  // 地面色块（几何分区）
  const res = 64;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res, res);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = sampleHeight(x, z);
    pos.setY(i, h * 0.15); // 轻微起伏，山体另建
    const g = sampleGeology(x, z);
    if (g === Geology.WATER) color.setHex(0x2a5a9a);
    else if (g === Geology.SOFT) color.setHex(0xb89858);
    else if (g === Geology.ROCK) color.setHex(0x6a6a6a);
    else if (g === Geology.MOUNTAIN) color.setHex(0x7a6548);
    else color.setHex(0x3d6a38);
    // 城区略暗
    const u = sampleUrbanDensity(x, z);
    if (g !== Geology.WATER && u > 0.35) {
      color.lerp(new THREE.Color(0x4a5060), u * 0.55);
    }
    colors.push(color.r, color.g, color.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.05,
      flatShading: false,
    })
  );
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // 河流水面（略抬高）
  addRiver(group);

  // 山体
  addMountain(group, -28, 22, 18, 14, 0x6b5a40);
  addMountain(group, 32, -28, 14, 11, 0x5a5040);

  // 城区建筑块
  addBuildings(group);

  // 网格辅助（弱）
  const grid = new THREE.GridHelper(WORLD_SIZE, 40, 0x2a3a55, 0x1a2838);
  grid.position.y = 0.05;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  group.add(grid);

  scene.add(group);
  return group;
}

function addRiver(group) {
  const pts = [];
  for (let x = -HALF; x <= HALF; x += 1.5) {
    const z = Math.sin(x * 0.06) * 8 + 4;
    pts.push(new THREE.Vector3(x, 0.2, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 80, 2.8, 8, false),
    new THREE.MeshStandardMaterial({
      color: 0x3a70c0,
      roughness: 0.35,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    })
  );
  tube.name = 'river';
  group.add(tube);
}

function addMountain(group, cx, cz, radius, height, hex) {
  const g = new THREE.ConeGeometry(radius * 0.95, height, 7);
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color: hex, roughness: 0.95, flatShading: true })
  );
  m.position.set(cx, height / 2, cz);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  // 山脚缓坡
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.15, radius * 1.35, height * 0.25, 8),
    new THREE.MeshStandardMaterial({ color: hex, roughness: 1, flatShading: true })
  );
  base.position.set(cx, height * 0.08, cz);
  group.add(base);
}

function addBuildings(group) {
  const matDense = new THREE.MeshStandardMaterial({ color: 0x5a6478, roughness: 0.8, metalness: 0.15 });
  const matMid = new THREE.MeshStandardMaterial({ color: 0x6a7080, roughness: 0.85 });
  const matLow = new THREE.MeshStandardMaterial({ color: 0x7a8068, roughness: 0.9 });
  const rng = mulberry32(42);
  for (let n = 0; n < 180; n++) {
    const x = (rng() - 0.5) * WORLD_SIZE * 0.85;
    const z = (rng() - 0.5) * WORLD_SIZE * 0.85;
    const geo = sampleGeology(x, z);
    if (geo === Geology.WATER || geo === Geology.MOUNTAIN) continue;
    const u = sampleUrbanDensity(x, z);
    if (u < 0.25) continue;
    const h = 1.2 + u * 8 + rng() * u * 6;
    const w = 1.2 + rng() * 1.8;
    const d = 1.2 + rng() * 1.8;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      u > 0.65 ? matDense : u > 0.4 ? matMid : matLow
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function setupLights(scene) {
  scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
  const sun = new THREE.DirectionalLight(0xfff0dd, 1.05);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6688cc, 0.35);
  fill.position.set(-30, 20, -40);
  scene.add(fill);
}
