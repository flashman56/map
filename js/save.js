/**
 * localStorage 存档 / 读档
 */
const KEY = 'metro-sandbox-save-v1';

export function saveGame(network, demandGrid, meta = {}) {
  const payload = {
    savedAt: new Date().toISOString(),
    meta,
    network: network.toJSON(),
    demand: demandGrid.cells.map((c) => ({
      i: c.i,
      j: c.j,
      growth: c.growth,
      demand: c.demand,
    })),
  };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload.savedAt;
}

export function loadGame() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function applyDemand(demandGrid, saved) {
  if (!saved?.demand) return;
  const map = new Map(saved.demand.map((d) => [`${d.i},${d.j}`, d]));
  for (const c of demandGrid.cells) {
    const d = map.get(`${c.i},${c.j}`);
    if (!d) continue;
    c.growth = d.growth ?? 1;
    c.demand = d.demand ?? c.baseDemand;
  }
}

export function hasSave() {
  return !!localStorage.getItem(KEY);
}
