// 경로 계산 (다익스트라). three.js에 의존하지 않아서 node 검사 스크립트에서도 쓴다.
import { COST } from './schema.js';
import { centroid } from './geom.js';

export const vec = (a) => ({ x: a[0], y: a[1], z: a[2] });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function floorOf(v, id) { return v.floors.find((f) => f.id === id); }

/** 방 문 위치 {x,y,z}. door가 없으면 폴리곤 중심 */
export function roomPos(v, room) {
  const f = floorOf(v, room.floor);
  const [x, z] = room.door || centroid(room.poly);
  return { x, y: f ? f.y : 0, z };
}

/** 같은 층에서 가장 가까운 노드 id */
export function nearestNode(v, pos, floorId) {
  const f = floorOf(v, floorId);
  let best = null, bd = Infinity;
  for (const [id, n] of Object.entries(v.nodes)) {
    if (f && Math.abs(n.p[1] - f.y) > 0.01) continue;
    const d = dist(pos, vec(n.p));
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/**
 * 방을 포함한 그래프. 방마다 가상 노드 "room:<id>"를 만들어
 * room.node(지정 노드) 또는 같은 층 최근접 노드에 walk로 잇는다.
 * 반환 { adj, pos }
 */
export function buildGraph(v, opts = {}) {
  const pos = {};
  for (const [id, n] of Object.entries(v.nodes)) pos[id] = vec(n.p);
  const adj = {};
  const add = (a, b, t, e) => { (adj[a] = adj[a] || []).push({ to: b, t, e }); };
  for (const [a, b, t, e] of v.edges) {
    if (opts.noStairs && (t === 'stair' || t === 'esc' || t === 'mix')) continue;
    add(a, b, t, e || 0); add(b, a, t, e || 0);
  }
  for (const r of v.rooms) {
    const rid = `room:${r.id}`;
    pos[rid] = roomPos(v, r);
    const n = r.node || nearestNode(v, pos[rid], r.floor);
    if (n && pos[n]) { add(rid, n, 'walk', r.est ? 1 : 0); add(n, rid, 'walk', r.est ? 1 : 0); }
  }
  return { adj, pos };
}

/** starts(노드 id 목록) 중 하나에서 targets 중 하나까지 최단. 반환 {cost, path:[{id,t,e}]} | null */
export function shortest(g, starts, targets) {
  const { adj, pos } = g;
  const d = {}, prev = {}, done = new Set();
  for (const s of starts) if (pos[s]) d[s] = 0;
  for (;;) {
    let u = null, best = Infinity;
    for (const k in d) if (!done.has(k) && d[k] < best) { best = d[k]; u = k; }
    if (u === null) return null;
    done.add(u);
    if (targets.includes(u)) return { cost: best, path: trace(u) };
    for (const e of adj[u] || []) {
      const c = COST[e.t] || COST.walk;
      const w = dist(pos[u], pos[e.to]) * c.w + c.fixed;
      if (d[e.to] === undefined || best + w < d[e.to]) { d[e.to] = best + w; prev[e.to] = { from: u, t: e.t, e: e.e }; }
    }
  }
  // path[i].t = path[i-1] → path[i] 로 온 연결 종류
  function trace(u) {
    const out = [{ id: u, t: null, e: 0 }];
    while (prev[u]) {
      const p = prev[u];
      out[0].t = p.t; out[0].e = p.e;
      out.unshift({ id: p.from, t: null, e: 0 });
      u = p.from;
    }
    return out;
  }
}

/** 출입구(들) → 방. fromId가 없으면 모든 출입구 중 가장 가까운 것 */
export function routeToRoom(v, fromId, room, opts = {}) {
  const g = buildGraph(v, opts);
  const starts = fromId ? [fromId] : Object.keys(v.nodes).filter((id) => v.nodes[id].type === 'entrance');
  if (!starts.length) return null;
  const r = shortest(g, starts, [`room:${room.id}`]);
  return r ? { ...r, g } : null;
}
