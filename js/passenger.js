/**
 * 简化客流：站点吸引、换乘阻抗路径、路段拥堵、城市发展
 */
import { capacityForFrequency } from './construction.js';

const TRANSFER_PENALTY = 2.5;
const WALK_RADIUS = 14;

export class PassengerSim {
  constructor(network, demandGrid) {
    this.network = network;
    this.demandGrid = demandGrid;
    this.enabled = true;
    this.peak = true;
    this.stats = {
      ridership: 0,
      avgTransfers: 0,
      worstSegment: '—',
      growthPct: 0,
    };
    this.stationBoardings = new Map();
    this._accum = 0;
  }

  setPeak(v) {
    this.peak = v;
  }

  setEnabled(v) {
    this.enabled = v;
  }

  update(dt) {
    if (!this.enabled) return;
    this._accum += dt;
    if (this._accum < 0.5) return;
    this._accum = 0;
    this.simulate();
    this.growCity(0.5);
  }

  simulate() {
    const stations = this.network.getStations();
    const segments = this.network.segments;
    for (const s of segments) {
      s.load = 0;
      const line = this.network.getLine(s.lineId);
      s.capacity = capacityForFrequency(line?.frequency || 'mid');
    }
    this.stationBoardings.clear();

    if (stations.length < 1) {
      this.stats = {
        ridership: 0,
        avgTransfers: 0,
        worstSegment: '—',
        growthPct: this.stats.growthPct,
      };
      this.network.applyCongestionColors();
      return;
    }

    const peakMul = this.peak ? 1.35 : 0.75;
    const boardings = new Map();
    for (const st of stations) boardings.set(st.id, 0);

    for (const cell of this.demandGrid.cells) {
      const demand = cell.demand * peakMul;
      const weights = [];
      let sumW = 0;
      for (const st of stations) {
        const d = Math.hypot(st.x - cell.x, st.z - cell.z);
        if (d > WALK_RADIUS) continue;
        const w = 1 / (1 + d * d * 0.08);
        weights.push({ st, w, d });
        sumW += w;
      }
      if (sumW <= 0) continue;
      for (const { st, w } of weights) {
        boardings.set(st.id, boardings.get(st.id) + (demand * w) / sumW);
      }
    }

    for (const st of stations) {
      const b = boardings.get(st.id) || 0;
      this.stationBoardings.set(st.id, b);
      st.visualScale = 1 + Math.min(1.8, b / 45);
    }

    const graph = this.buildGraph(stations);
    if (graph.nodes.size < 2) {
      this.stats.ridership = Math.round([...boardings.values()].reduce((a, b) => a + b, 0));
      this.stats.avgTransfers = 0;
      this.network.applyCongestionColors();
      return;
    }

    let totalTrips = 0;
    let totalTransfers = 0;
    const stationList = stations.map((s) => s.id);
    const attraction = stationList.map((id) => boardings.get(id) || 0.1);
    const attrSum = attraction.reduce((a, b) => a + b, 0) || 1;

    for (let i = 0; i < stationList.length; i++) {
      const origin = stationList[i];
      const out = (boardings.get(origin) || 0) * 0.85;
      if (out < 0.05) continue;
      for (let j = 0; j < stationList.length; j++) {
        if (i === j) continue;
        const dest = stationList[j];
        const trips = (out * attraction[j]) / (attrSum - attraction[i] + 0.01);
        if (trips < 0.02) continue;
        const path = this.shortestPath(graph, origin, dest);
        if (!path) continue;
        totalTrips += trips;
        totalTransfers += trips * path.transfers;
        for (const edge of path.edges) {
          const seg = segments.find((s) => s.id === edge.segId);
          if (seg) seg.load += trips;
        }
      }
    }

    let worst = null;
    let worstC = 0;
    for (const s of segments) {
      s.congestion = s.capacity > 0 ? s.load / s.capacity : 0;
      if (s.congestion > worstC) {
        worstC = s.congestion;
        const line = this.network.getLine(s.lineId);
        worst = `${line?.name || '?'} ${(worstC * 100).toFixed(0)}%`;
      }
    }
    this.network.applyCongestionColors();

    this.stats.ridership = Math.round(
      totalTrips || [...boardings.values()].reduce((a, b) => a + b, 0)
    );
    this.stats.avgTransfers =
      totalTrips > 0 ? Math.round((totalTransfers / totalTrips) * 100) / 100 : 0;
    this.stats.worstSegment = worst || '—';
  }

  buildGraph(stations) {
    const nodes = new Map();
    for (const st of stations) nodes.set(st.id, []);

    for (const line of this.network.lines) {
      const lineStations = line.stationIds.filter((id) => this.network.nodes.get(id)?.station);
      const adj = new Map();
      for (const s of this.network.segments) {
        if (s.lineId !== line.id) continue;
        if (!adj.has(s.a)) adj.set(s.a, []);
        if (!adj.has(s.b)) adj.set(s.b, []);
        adj.get(s.a).push({ to: s.b, seg: s });
        adj.get(s.b).push({ to: s.a, seg: s });
      }

      for (let i = 0; i < lineStations.length; i++) {
        for (let j = i + 1; j < lineStations.length; j++) {
          const path = this._walkSegments(adj, lineStations[i], lineStations[j]);
          if (!path) continue;
          const cost = path.segIds.length;
          const congPenalty = path.segIds.reduce((acc, id) => {
            const seg = this.network.segments.find((s) => s.id === id);
            return acc + (seg && seg.congestion > 0.85 ? 0.5 : 0);
          }, 0);
          nodes.get(lineStations[i]).push({
            to: lineStations[j],
            cost: cost + congPenalty,
            lineId: line.id,
            segIds: path.segIds,
            transfer: false,
          });
          nodes.get(lineStations[j]).push({
            to: lineStations[i],
            cost: cost + congPenalty,
            lineId: line.id,
            segIds: path.segIds,
            transfer: false,
          });
        }
      }
    }
    return { nodes };
  }

  _walkSegments(adj, start, goal) {
    if (start === goal) return { segIds: [] };
    const queue = [[start]];
    const visited = new Set([start]);
    const cameSeg = new Map();
    while (queue.length) {
      const path = queue.shift();
      const cur = path[path.length - 1];
      for (const { to, seg } of adj.get(cur) || []) {
        if (visited.has(to)) continue;
        visited.add(to);
        cameSeg.set(to, { from: cur, segId: seg.id });
        if (to === goal) {
          const segIds = [];
          let c = goal;
          while (c !== start) {
            const info = cameSeg.get(c);
            if (!info) return null;
            segIds.push(info.segId);
            c = info.from;
          }
          return { segIds };
        }
        queue.push([...path, to]);
      }
    }
    return null;
  }

  shortestPath(graph, origin, dest) {
    const dist = new Map();
    const prev = new Map();
    const key0 = `${origin}|null`;
    dist.set(key0, 0);
    const pq = [{ key: key0, d: 0, station: origin, lineId: null }];

    const push = (item) => {
      pq.push(item);
      pq.sort((a, b) => a.d - b.d);
    };

    while (pq.length) {
      const cur = pq.shift();
      if (cur.d !== dist.get(cur.key)) continue;
      if (cur.station === dest) {
        return this._reconstruct(prev, cur.key, origin);
      }
      for (const edge of graph.nodes.get(cur.station) || []) {
        let add = edge.cost;
        let transfers = 0;
        if (cur.lineId && cur.lineId !== edge.lineId) {
          add += TRANSFER_PENALTY;
          transfers = 1;
        }
        const nk = `${edge.to}|${edge.lineId}`;
        const nd = cur.d + add;
        if (!dist.has(nk) || nd < dist.get(nk)) {
          dist.set(nk, nd);
          prev.set(nk, { from: cur.key, edge, transfers });
          push({ key: nk, d: nd, station: edge.to, lineId: edge.lineId });
        }
      }
    }
    return null;
  }

  _reconstruct(prev, endKey, origin) {
    const edges = [];
    let transfers = 0;
    let k = endKey;
    while (prev.has(k)) {
      const p = prev.get(k);
      transfers += p.transfers || 0;
      for (const sid of p.edge.segIds) {
        edges.push({ segId: sid, lineId: p.edge.lineId });
      }
      k = p.from;
      const station = k.split('|')[0];
      if (station === origin && !prev.has(k)) break;
    }
    return { edges, transfers };
  }

  growCity(dt) {
    const stations = this.network.getStations();
    let total = this.demandGrid.cells.length || 1;
    for (const cell of this.demandGrid.cells) {
      let covered = false;
      for (const st of stations) {
        if (Math.hypot(st.x - cell.x, st.z - cell.z) < WALK_RADIUS * 0.85) {
          covered = true;
          break;
        }
      }
      cell.covered = covered;
      if (covered) {
        cell.growth = Math.min(2.2, cell.growth + dt * 0.008);
      } else {
        cell.growth = Math.min(1.15, cell.growth + dt * 0.0008);
      }
      cell.demand = cell.baseDemand * cell.growth;
    }
    const avgGrowth =
      this.demandGrid.cells.reduce((a, c) => a + (c.growth - 1), 0) / total;
    this.stats.growthPct = Math.round(avgGrowth * 100);
  }
}
