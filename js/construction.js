/**
 * 工法与建造代价：建造耗时 + 难度点数
 */
import { sampleGeology, sampleUrbanDensity, sampleHeight, Geology } from './world.js';

export const METHODS = {
  elevated: {
    id: 'elevated',
    name: '高架',
    hint: '平原开阔区首选，代价最低。不可直接跨主峰或无桥跨河。',
  },
  bridge: {
    id: 'bridge',
    name: '桥梁',
    hint: '用于跨河/跨湖；水面越宽代价越高。',
  },
  mountain_tunnel: {
    id: 'mountain_tunnel',
    name: '山隧',
    hint: '穿山专用；硬岩更慢但稳定。极高山脊仅允许山隧。',
  },
  shield: {
    id: 'shield',
    name: '盾构',
    hint: '建成区地下优先；减少扰民，但代价高。',
  },
  cut_cover: {
    id: 'cut_cover',
    name: '明挖',
    hint: '低密度区浅埋可接受；高密度区扰民惩罚大。',
  },
};

const FREQ_CAPACITY = { low: 40, mid: 80, high: 140 };

export function capacityForFrequency(freq) {
  return FREQ_CAPACITY[freq] || FREQ_CAPACITY.mid;
}

/**
 * 沿线段采样若干点，评估工法是否合适，返回耗时与难度
 * @returns {{ ok: boolean, blocked: boolean, time: number, difficulty: number, message: string, samples: object[] }}
 */
export function evaluateSegment(ax, az, bx, bz, methodId) {
  const samples = [];
  const n = 10;
  let waterHits = 0;
  let mountainHits = 0;
  let softHits = 0;
  let rockHits = 0;
  let maxUrban = 0;
  let maxHeight = 0;
  let length = Math.hypot(bx - ax, bz - az);

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const geo = sampleGeology(x, z);
    const urban = sampleUrbanDensity(x, z);
    const h = sampleHeight(x, z);
    samples.push({ x, z, geo, urban, h });
    if (geo === Geology.WATER) waterHits++;
    if (geo === Geology.MOUNTAIN) mountainHits++;
    if (geo === Geology.SOFT) softHits++;
    if (geo === Geology.ROCK) rockHits++;
    maxUrban = Math.max(maxUrban, urban);
    maxHeight = Math.max(maxHeight, h);
  }

  const waterRatio = waterHits / (n + 1);
  const mountainRatio = mountainHits / (n + 1);
  const softRatio = softHits / (n + 1);
  const rockRatio = rockHits / (n + 1);

  let time = length * 1.2; // 基准耗时
  let difficulty = length * 1.0;
  let blocked = false;
  let ok = true;
  const notes = [];

  switch (methodId) {
    case 'elevated': {
      if (waterRatio > 0.15) {
        blocked = true;
        notes.push('高架无法跨河，请改用桥梁或水下隧道（盾构）。');
      } else if (mountainRatio > 0.2 || maxHeight > 8) {
        blocked = true;
        notes.push('高架无法穿越主峰，请绕行或改用山隧。');
      } else {
        if (softRatio > 0.3) {
          time *= 1.4;
          difficulty *= 1.6;
          notes.push('软土区高架需加固，难度↑。');
        }
        if (maxUrban > 0.7) {
          time *= 1.25;
          difficulty *= 1.35;
          notes.push('高密度城区高架扰民，建议盾构。');
        }
        notes.push(notes.length ? '' : '高架适宜，代价较低。');
      }
      break;
    }
    case 'bridge': {
      if (waterRatio < 0.08 && mountainRatio < 0.1) {
        time *= 1.15;
        difficulty *= 1.2;
        notes.push('非跨水域使用桥梁，略增成本。');
      }
      if (mountainRatio > 0.25) {
        blocked = true;
        notes.push('桥梁不适合穿山，请改用山隧。');
      } else {
        time *= 1.5 + waterRatio * 2.5;
        difficulty *= 1.6 + waterRatio * 2.2;
        if (waterRatio > 0.4) notes.push('宽河桥梁，耗时与难度显著↑。');
        else notes.push('桥梁方案可行。');
      }
      break;
    }
    case 'mountain_tunnel': {
      if (mountainRatio < 0.1 && maxHeight < 3) {
        time *= 1.8;
        difficulty *= 2.0;
        notes.push('平原挖山隧不划算，建议高架/明挖。');
      } else {
        time *= 2.2 + rockRatio * 1.2;
        difficulty *= 2.0 + rockRatio * 0.8;
        if (length > 25) {
          time *= 1.4;
          difficulty *= 1.5;
          notes.push('长隧道建议分段施工，代价↑。');
        } else {
          notes.push('山隧方案可行。');
        }
      }
      if (waterRatio > 0.2) {
        time *= 1.5;
        difficulty *= 1.6;
        notes.push('含水地层增加隧道难度。');
      }
      break;
    }
    case 'shield': {
      time *= 2.4;
      difficulty *= 2.6;
      if (maxUrban > 0.5) {
        time *= 0.9; // 城区盾构相对更合理
        difficulty *= 0.85;
        notes.push('城区盾构减少扰民，推荐。');
      } else {
        notes.push('空旷区用盾构偏贵，但可行。');
      }
      if (softRatio > 0.4) {
        time *= 1.35;
        difficulty *= 1.5;
        notes.push('软土盾构需加固，难度↑。');
      }
      if (mountainRatio > 0.3) {
        time *= 1.3;
        difficulty *= 1.4;
        notes.push('山地段盾构接近山隧难度。');
      }
      break;
    }
    case 'cut_cover': {
      if (waterRatio > 0.12) {
        blocked = true;
        notes.push('明挖无法跨河，请改桥梁/盾构。');
      } else if (mountainRatio > 0.2 || maxHeight > 7) {
        blocked = true;
        notes.push('明挖无法穿主峰，请改山隧。');
      } else {
        time *= 1.5;
        difficulty *= 1.4;
        if (maxUrban > 0.7) {
          time *= 1.8;
          difficulty *= 2.2;
          notes.push('高密度区明挖扰民严重，强烈建议盾构。');
          ok = false; // 不阻断，但标记不优
        } else if (maxUrban > 0.4) {
          time *= 1.3;
          difficulty *= 1.5;
          notes.push('中密度区明挖可接受，耗时略增。');
        } else {
          notes.push('低密度区明挖适宜。');
        }
        if (softRatio > 0.35) {
          time *= 1.4;
          difficulty *= 1.7;
          notes.push('软土浅埋沉降风险↑。');
        }
      }
      break;
    }
    default:
      notes.push('未知工法');
      blocked = true;
  }

  time = Math.round(time * 10) / 10;
  difficulty = Math.round(difficulty * 10) / 10;
  const message = notes.filter(Boolean).join(' ');

  return {
    ok: !blocked && ok,
    blocked,
    time,
    difficulty,
    message,
    length,
    waterRatio,
    mountainRatio,
    samples,
  };
}

/** 归一化到 0~100 条显示 */
export function normalizeBar(value, softMax = 80) {
  return Math.min(100, Math.round((value / softMax) * 100));
}
