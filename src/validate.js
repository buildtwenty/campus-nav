// 데이터 검사. 브라우저(편집기)와 node(tools/validate.js) 양쪽에서 쓴다.
import { VERTICAL, ROOM_TYPES, NODE_TYPES } from './schema.js';
import { area, pointInPoly, centroid } from './geom.js';
import { buildGraph, shortest } from './route.js';

/** 반환 { errors:[], warnings:[], stats:{} } */
export function validate(v) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

  if (!v.id || !/^[a-z0-9-]+$/.test(v.id)) err(`id는 소문자·숫자·하이픈만: "${v.id}"`);
  if (!v.name) err('name이 없습니다');
  if (!Array.isArray(v.floors) || !v.floors.length) err('floors가 비어 있습니다');

  const floorIds = new Set();
  for (const f of v.floors || []) {
    if (floorIds.has(f.id)) err(`층 id 중복: ${f.id}`);
    floorIds.add(f.id);
    if (typeof f.y !== 'number') err(`층 ${f.id}: y(높이)가 숫자가 아닙니다`);
    const polys = f.polys && f.polys.length ? f.polys : [f.poly];
    polys.forEach((p, i) => {
      const tag = polys.length > 1 ? `층 ${f.id} 조각 ${i + 1}` : `층 ${f.id}`;
      if (!p || p.length < 3) err(`${tag}: 외곽 poly가 3점 미만`);
      else if (area(p) < 1) warn(`${tag}: 외곽 면적이 1 m² 미만 (축척 확인)`);
    });
    if (!f.height) warn(`층 ${f.id}: height 없음 → 기본값 사용`);
    if (!f.plan || !f.plan.file) warn(`층 ${f.id}: 참고 도면(plan.file)이 없음 → 나중에 수정하기 어렵습니다`);
  }

  const roomIds = new Set(), roomNos = {};
  for (const r of v.rooms || []) {
    if (roomIds.has(r.id)) err(`방 id 중복: ${r.id}`);
    roomIds.add(r.id);
    if (!floorIds.has(r.floor)) err(`방 ${r.id}: 없는 층 ${r.floor}`);
    if (!r.poly || r.poly.length < 3) err(`방 ${r.id}: poly가 3점 미만`);
    if (!r.no) warn(`방 ${r.id}: 번호(no) 없음`);
    else { const k = `${r.floor}/${r.no}`; (roomNos[k] = roomNos[k] || []).push(r.id); }   // 같은 층 안에서만 중복 검사 (화장실 WC-1 등은 층마다 반복)
    if (r.type && !ROOM_TYPES[r.type]) warn(`방 ${r.id}: 모르는 type ${r.type}`);
    const f = (v.floors || []).find((f) => f.id === r.floor);
    const fpolys = f ? (f.polys && f.polys.length ? f.polys : [f.poly]) : [];
    if (fpolys.length && r.poly && r.poly.length >= 3 && !fpolys.some((p) => p && pointInPoly(centroid(r.poly), p))) warn(`방 ${r.no || r.id}: 중심이 층 외곽 밖`);
  }
  for (const [no, ids] of Object.entries(roomNos)) if (ids.length > 1) warn(`방 번호 ${no} 중복: ${ids.join(', ')}`);

  const nodes = v.nodes || {};
  for (const [id, n] of Object.entries(nodes)) {
    if (!n.p || n.p.length !== 3) err(`노드 ${id}: p가 [x,y,z]가 아닙니다`);
    else if (!(v.floors || []).some((f) => Math.abs(f.y - n.p[1]) < 0.01)) err(`노드 ${id}: y=${n.p[1]}가 어느 층 높이와도 맞지 않음`);
    if (!NODE_TYPES[n.type]) warn(`노드 ${id}: 모르는 type ${n.type}`);
  }
  for (const e of v.edges || []) {
    const [a, b, t] = e;
    if (!nodes[a]) err(`연결 ${a}-${b}: 노드 ${a} 없음`);
    if (!nodes[b]) err(`연결 ${a}-${b}: 노드 ${b} 없음`);
    if (nodes[a] && nodes[b] && Math.abs(nodes[a].p[1] - nodes[b].p[1]) > 0.01 && !VERTICAL.has(t)) err(`연결 ${a}-${b}: 층이 다른데 type=${t} (stair/elevator/esc/mix 중 하나여야)`);
  }

  // 도달성: 출입구 → 모든 방
  const entrances = Object.keys(nodes).filter((id) => nodes[id].type === 'entrance');
  if (Object.keys(nodes).length && !entrances.length) warn('entrance 노드가 없어 길찾기를 못 합니다');
  if (entrances.length && (v.rooms || []).length) {
    const g = buildGraph(v);
    const unreachable = v.rooms.filter((r) => !shortest(g, entrances, [`room:${r.id}`]));
    if (unreachable.length) warn(`출입구에서 못 가는 방 ${unreachable.length}개: ${unreachable.slice(0, 8).map((r) => r.no || r.id).join(', ')}${unreachable.length > 8 ? ' …' : ''}`);
  }

  const estCount = (v.rooms || []).filter((r) => r.est).length + Object.values(nodes).filter((n) => n.est).length + (v.edges || []).filter((e) => e[3]).length;
  const total = (v.rooms || []).length + Object.keys(nodes).length + (v.edges || []).length;
  const stats = {
    floors: (v.floors || []).length, rooms: (v.rooms || []).length, nodes: Object.keys(nodes).length, edges: (v.edges || []).length,
    estRatio: total ? Math.round((estCount / total) * 100) / 100 : 0,
  };
  return { errors, warnings, stats };
}
