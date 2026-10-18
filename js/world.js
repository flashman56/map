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

/** 采样点世界坐标 → 地质（硬分区，供施工/需求逻辑使用） */
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

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Soft visual weights for ground tint (does not affect gameplay geology) */
function sampleGroundTint(x, z, out) {
  const riverZ = Math.sin(x * 0.06) * 8 + 4;
  const riverDist = Math.abs(z - riverZ);
  const m1 = Math.hypot(x + 28, z + 22);
  const m2 = Math.hypot(x - 32, z - 28);
  const softEast = Math.hypot(x - 35, z - 5);

  const water = 1 - smoothstep(2.2, 3.8, riverDist);
  const softBank = (1 - smoothstep(5.5, 11.5, riverDist)) * (1 - water);
  const softBowl = (1 - smoothstep(10, 17, softEast)) * (x > 18 ? 1 : 0) * (1 - water);
  const soft = Math.min(1, softBank * 0.85 + softBowl * 0.9);
  const mountain = Math.max(
    1 - smoothstep(12, 19, m1),
    1 - smoothstep(9, 15, m2)
  );
  const rock = Math.max(
    (1 - smoothstep(18, 27, m1)) * (1 - mountain),
    (1 - smoothstep(14, 21, m2)) * (1 - mountain)
  );
  const urban = sampleUrbanDensity(x, z);
  // Park patches: low-urban soft/green pockets
  const parkA = 1 - smoothstep(6, 11, Math.hypot(x + 8, z - 18));
  const parkB = 1 - smoothstep(5, 9, Math.hypot(x - 22, z + 6));
  const park = Math.max(parkA, parkB) * (1 - water) * (1 - mountain) * (1 - urban * 0.7);

  // Base colors
  const cGrass = new THREE.Color(0x3f7240);
  const cSoft = new THREE.Color(0xc4a86a);
  const cRock = new THREE.Color(0x6e6e72);
  const cMtn = new THREE.Color(0x7a6a52);
  const cWater = new THREE.Color(0x2a568c);
  const cUrban = new THREE.Color(0x4e5566);
  const cPark = new THREE.Color(0x4a8a52);
  const cPlain = new THREE.Color(0x457848);

  out.copy(cPlain);
  out.lerp(cGrass, 0.35);
  out.lerp(cSoft, soft * 0.92);
  out.lerp(cRock, rock * 0.75);
  out.lerp(cMtn, mountain * 0.9);
  out.lerp(cPark, park * 0.85);
  out.lerp(cWater, water * 0.95);
  if (urban > 0.12 && water < 0.4 && mountain < 0.35) {
    out.lerp(cUrban, urban * 0.58);
  }
  // subtle noise-ish variation from position (deterministic, no rng alloc)
  const n = Math.sin(x * 0.31 + z * 0.27) * Math.cos(x * 0.17 - z * 0.23);
  out.offsetHSL(0, 0, n * 0.025);
  return out;
}

export function createWorldGroup(scene) {
  const group = new THREE.Group();
  group.name = 'world';

  // 地面：更高细分 + 柔和色带过渡
  const res = 96;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, res, res);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = sampleHeight(x, z);
    // Gentle ground undulation; full hills are separate smooth meshes
    pos.setY(i, h * 0.12);
    sampleGroundTint(x, z, color);
    colors.push(color.r, color.g, color.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.04,
      flatShading: false,
    })
  );
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // 河流水面（扁平丝带，非圆柱）
  addRiver(group);

  // 平滑山丘
  addMountain(group, -28, 22, 18, 14, 0x6e5c44);
  addMountain(group, 32, -28, 14, 11, 0x5e5444);

  // 城区建筑块
  addBuildings(group);

  // 弱网格
  const grid = new THREE.GridHelper(WORLD_SIZE, 40, 0x2a3a55, 0x1a2838);
  grid.position.y = 0.04;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  group.add(grid);

  scene.add(group);
  return group;
}

function addRiver(group) {
  // Flat water ribbon along the same sinusoidal path as sampleGeology (half-width ~3.2)
  const halfWidth = 3.0;
  const step = 1.25;
  const y = 0.06;
  const centers = [];
  for (let x = -HALF; x <= HALF; x += step) {
    const z = Math.sin(x * 0.06) * 8 + 4;
    centers.push(new THREE.Vector3(x, y, z));
  }

  const positions = [];
  const normals = [];
  const indices = [];
  const n = centers.length;

  for (let i = 0; i < n; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(n - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
    else perp.normalize();

    const c = centers[i];
    const left = new THREE.Vector3().copy(c).addScaledVector(perp, -halfWidth);
    const right = new THREE.Vector3().copy(c).addScaledVector(perp, halfWidth);
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(0, 1, 0, 0, 1, 0);

    if (i < n - 1) {
      const a = i * 2;
      const b = a + 1;
      const cIdx = a + 2;
      const d = a + 3;
      indices.push(a, b, cIdx, b, d, cIdx);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const river = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0x2f6eb8,
      roughness: 0.12,
      metalness: 0.35,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.2,
    })
  );
  river.name = 'river';
  river.renderOrder = 1;
  river.userData.animateWater = true;
  group.add(river);

  // Specular highlight ribbon (narrower, brighter)
  const shinePositions = [];
  const shineNormals = [];
  const shineIndices = [];
  const shineHalf = halfWidth * 0.35;
  for (let i = 0; i < n; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(n - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
    else perp.normalize();
    const c = centers[i];
    const left = new THREE.Vector3(c.x, 0.08, c.z).addScaledVector(perp, -shineHalf);
    const right = new THREE.Vector3(c.x, 0.08, c.z).addScaledVector(perp, shineHalf);
    shinePositions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    shineNormals.push(0, 1, 0, 0, 1, 0);
    if (i < n - 1) {
      const a = i * 2;
      const b = a + 1;
      shineIndices.push(a, b, a + 2, b, a + 3, a + 2);
    }
  }
  const shineGeo = new THREE.BufferGeometry();
  shineGeo.setAttribute('position', new THREE.Float32BufferAttribute(shinePositions, 3));
  shineGeo.setAttribute('normal', new THREE.Float32BufferAttribute(shineNormals, 3));
  shineGeo.setIndex(shineIndices);
  const shine = new THREE.Mesh(
    shineGeo,
    new THREE.MeshBasicMaterial({
      color: 0xa8d8ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  shine.name = 'river-shine';
  shine.renderOrder = 2;
  shine.userData.animateWater = true;
  group.add(shine);

  // Soft bank highlight strip (slightly wider, more transparent)
  const bankPositions = [];
  const bankNormals = [];
  const bankIndices = [];
  const bankHalf = halfWidth + 1.1;
  for (let i = 0; i < n; i++) {
    const prev = centers[Math.max(0, i - 1)];
    const next = centers[Math.min(n - 1, i + 1)];
    const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x);
    if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1);
    else perp.normalize();
    const c = centers[i];
    const left = new THREE.Vector3(c.x, 0.045, c.z).addScaledVector(perp, -bankHalf);
    const right = new THREE.Vector3(c.x, 0.045, c.z).addScaledVector(perp, bankHalf);
    bankPositions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    bankNormals.push(0, 1, 0, 0, 1, 0);
    if (i < n - 1) {
      const a = i * 2;
      const b = a + 1;
      bankIndices.push(a, b, a + 2, b, a + 3, a + 2);
    }
  }
  const bankGeo = new THREE.BufferGeometry();
  bankGeo.setAttribute('position', new THREE.Float32BufferAttribute(bankPositions, 3));
  bankGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bankNormals, 3));
  bankGeo.setIndex(bankIndices);
  const bank = new THREE.Mesh(
    bankGeo,
    new THREE.MeshStandardMaterial({
      color: 0x5a9ad0,
      roughness: 0.4,
      metalness: 0.05,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  bank.name = 'river-bank';
  bank.renderOrder = 0;
  group.add(bank);
}

/** Smooth schematic hill from a displaced radial mesh (not a cone/cylinder) */
function addMountain(group, cx, cz, radius, height, hex) {
  const radial = 36;
  const rings = 18;
  const positions = [];
  const colors = [];
  const indices = [];
  const base = new THREE.Color(hex);
  const tip = new THREE.Color(hex).offsetHSL(0.02, -0.05, 0.12);
  const foot = new THREE.Color(hex).offsetHSL(-0.01, 0.05, -0.08);

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = radius * 1.05 * t;
    // Smooth dome: flatter near foot, rounded crown
    const h = height * Math.pow(1 - t, 1.65) * (0.92 + 0.08 * Math.cos(t * Math.PI));
    const seg = r === 0 ? 1 : radial;
    for (let i = 0; i < seg; i++) {
      const a = (i / radial) * Math.PI * 2;
      // Slight elliptical / lobe variation for less perfect blob
      const lobe = 1 + 0.06 * Math.sin(a * 2 + cx * 0.1) + 0.04 * Math.cos(a * 3 - cz * 0.08);
      const rr = rad * lobe;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const y = r === 0 ? height * 0.98 : h * (0.96 + 0.04 * Math.sin(a * 2));
      positions.push(x, Math.max(0.02, y), z);
      const c = foot.clone().lerp(base, smoothstep(0.15, 0.55, 1 - t)).lerp(tip, smoothstep(0.55, 0.95, 1 - t));
      colors.push(c.r, c.g, c.b);
      if (r === 0) break;
    }
  }

  // Index: ring 0 = apex (1 vert), then rings of `radial` verts
  const ringStart = (r) => (r === 0 ? 0 : 1 + (r - 1) * radial);

  for (let r = 1; r <= rings; r++) {
    const prevStart = ringStart(r - 1);
    const curStart = ringStart(r);
    for (let i = 0; i < radial; i++) {
      const i1 = (i + 1) % radial;
      if (r === 1) {
        // triangles to apex
        indices.push(0, curStart + i, curStart + i1);
      } else {
        const a = prevStart + i;
        const b = prevStart + i1;
        const c = curStart + i;
        const d = curStart + i1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
    })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'mountain';
  group.add(mesh);
}

function addBuildings(group) {
  const palettes = {
    dense: [
      new THREE.MeshStandardMaterial({ color: 0x5a6578, roughness: 0.72, metalness: 0.22 }),
      new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.7, metalness: 0.28 }),
      new THREE.MeshStandardMaterial({ color: 0x6a7388, roughness: 0.68, metalness: 0.2 }),
    ],
    mid: [
      new THREE.MeshStandardMaterial({ color: 0x6a7080, roughness: 0.82, metalness: 0.08 }),
      new THREE.MeshStandardMaterial({ color: 0x7a7888, roughness: 0.8, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: 0x5e6874, roughness: 0.84, metalness: 0.06 }),
    ],
    low: [
      new THREE.MeshStandardMaterial({ color: 0x8a8570, roughness: 0.9, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0x7a8068, roughness: 0.92, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0x9a8a78, roughness: 0.88, metalness: 0.03 }),
      new THREE.MeshStandardMaterial({ color: 0x6e7a6a, roughness: 0.9, metalness: 0.02 }),
    ],
  };
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x3a4250,
    roughness: 0.85,
    metalness: 0.15,
  });

  const rng = mulberry32(42);
  let placed = 0;
  let attempts = 0;
  while (placed < 200 && attempts < 900) {
    attempts++;
    const x = (rng() - 0.5) * WORLD_SIZE * 0.85;
    const z = (rng() - 0.5) * WORLD_SIZE * 0.85;
    const geoType = sampleGeology(x, z);
    if (geoType === Geology.WATER || geoType === Geology.MOUNTAIN) continue;
    const u = sampleUrbanDensity(x, z);
    if (u < 0.22) continue;

    // Varied footprints
    const footprintRoll = rng();
    let w, d, h;
    if (u > 0.7 && footprintRoll > 0.55) {
      // Tower / slab
      w = 1.4 + rng() * 1.6;
      d = 1.4 + rng() * 1.6;
      h = 6 + u * 10 + rng() * 8;
    } else if (footprintRoll < 0.25) {
      // Long bar
      w = 2.2 + rng() * 3.2;
      d = 1.0 + rng() * 1.2;
      h = 1.4 + u * 5 + rng() * 3;
    } else if (footprintRoll < 0.45) {
      // Wide low
      w = 2.0 + rng() * 2.4;
      d = 2.0 + rng() * 2.4;
      h = 1.0 + u * 3.5 + rng() * 2;
    } else {
      // Standard
      w = 1.1 + rng() * 2.0;
      d = 1.1 + rng() * 2.0;
      h = 1.3 + u * 7 + rng() * u * 5;
    }

    const tier = u > 0.65 ? 'dense' : u > 0.4 ? 'mid' : 'low';
    const mats = palettes[tier];
    const mat = mats[Math.floor(rng() * mats.length)];

    let px = x;
    let pz = z;
    // Slight grid-ish snap for denser urban feel
    if (u > 0.5) {
      px = Math.round(x / 2.5) * 2.5 + (rng() - 0.5) * 0.4;
      pz = Math.round(z / 2.5) * 2.5 + (rng() - 0.5) * 0.4;
      const g2 = sampleGeology(px, pz);
      if (g2 === Geology.WATER || g2 === Geology.MOUNTAIN) continue;
    }

    const building = new THREE.Group();
    let bodyH = h;
    let baseY = 0;

    // Occasional setback / podium for dense towers
    if (u > 0.7 && rng() > 0.65 && h > 8) {
      const podH = 1.2 + rng() * 1.4;
      const podium = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.35, podH, d * 1.35),
        mats[Math.floor(rng() * mats.length)]
      );
      podium.position.y = podH / 2;
      podium.castShadow = true;
      podium.receiveShadow = true;
      building.add(podium);
      baseY = podH;
      bodyH = h - podH;
    }

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), mat);
    body.position.y = baseY + bodyH / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    building.add(body);

    // Simple flat roof cap for taller buildings
    if (h > 3.5) {
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.04, Math.min(0.35, h * 0.04), d * 1.04),
        roofMat
      );
      roof.position.y = baseY + bodyH + 0.02;
      roof.castShadow = true;
      building.add(roof);
    }

    // Emissive window strip for denser / taller buildings
    if (u > 0.45 && bodyH > 3) {
      const winMat = new THREE.MeshStandardMaterial({
        color: 0x1a2230,
        emissive: new THREE.Color().setHSL(0.12 + rng() * 0.08, 0.55, 0.45),
        emissiveIntensity: 0.55 + rng() * 0.45,
        roughness: 0.4,
        metalness: 0.2,
      });
      const win = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.15, w * 0.72), bodyH * 0.82, Math.max(0.05, d * 0.08)),
        winMat
      );
      win.position.set(0, baseY + bodyH / 2, d / 2 + 0.02);
      building.add(win);
      if (rng() > 0.4) {
        const win2 = win.clone();
        win2.position.z = -d / 2 - 0.02;
        building.add(win2);
      }
    }

    building.position.set(px, 0, pz);
    const yawJitter = (rng() - 0.5) * 0.28;
    const cardinal = rng() > 0.75 ? (Math.floor(rng() * 4) * Math.PI) / 2 : 0;
    building.rotation.y = yawJitter + cardinal;

    group.add(building);
    placed++;
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
  scene.add(new THREE.AmbientLight(0xa8bdd8, 0.52));
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.25);
  sun.position.set(45, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6a90c8, 0.42);
  fill.position.set(-35, 25, -40);
  scene.add(fill);
  const hemi = new THREE.HemisphereLight(0xb8d0f0, 0x3a4a38, 0.35);
  scene.add(hemi);
  // Soft city glow near downtown
  const cityGlow = new THREE.PointLight(0xffc070, 0.55, 55, 2);
  cityGlow.position.set(2, 8, -8);
  scene.add(cityGlow);
}

/** Subtle water shimmer — call from main loop */
export function animateWorld(scene, time) {
  const world = scene.getObjectByName('world');
  if (!world) return;
  world.traverse((obj) => {
    if (!obj.userData?.animateWater || !obj.material) return;
    if (obj.name === 'river-shine') {
      obj.material.opacity = 0.14 + Math.sin(time * 1.6) * 0.1 + Math.sin(time * 3.1) * 0.04;
    } else if (obj.name === 'river') {
      obj.material.opacity = 0.72 + Math.sin(time * 0.7) * 0.05;
    }
  });
}
