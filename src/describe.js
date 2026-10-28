// 경로 → 한국어 단계 안내
import { HOW_KO } from './schema.js';

function josa(word, a, b) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return a;
  const j = (c - 0xac00) % 28;
  return j === 0 || j === 8 ? a : b;
}

function labelOf(v, id) {
  if (id.startsWith('room:')) {
    const r = v.rooms.find((x) => x.id === id.slice(5));
    return r ? `${r.no}호${r.name ? ' ' + r.name : ''}` : id;
  }
  return (v.nodes[id] && v.nodes[id].label) || id;
}

function floorLabel(v, y) {
  const f = v.floors.find((f) => Math.abs(f.y - y) < 0.01);
  return f ? f.label : '';
}

/** r = routeToRoom() 결과({path, g}). 반환: [{text, tag?, q?(추정이면 1)}] */
export function describe(v, r) {
  if (!r) return [{ text: '경로를 찾지 못했습니다. 노드·연결(nodes/edges)이 비어 있거나 끊겨 있습니다.' }];
  const { path, g } = r, out = [];
  const first = path[0];
  const fl = floorLabel(v, g.pos[first.id].y);
  out.push({ text: `${labelOf(v, first.id)}${fl ? ` (${fl})` : ''}에서 출발합니다.` });
  for (let i = 1; i < path.length; i++) {
    const s = path[i], name = labelOf(v, s.id);
    const dy = g.pos[s.id].y - g.pos[path[i - 1].id].y;
    if (s.t === 'gate') out.push({ text: `${name}${josa(name, '를', '을')} 통과합니다.`, q: s.e });
    else if (s.t === 'walk' || !s.t) {
      const last = i === path.length - 1;
      const n = v.nodes[s.id];
      // 이름 없는 복도 분기점은 안내문에서 건너뛴다 (경로 선에는 그대로 있음)
      if (!last && n && n.type === 'corridor' && !n.label) continue;
      out.push({ text: last ? `${name}에 도착합니다.` : `${name}까지 걸어갑니다.`, q: s.e });
    } else {
      out.push({ text: `${HOW_KO[s.t]} ${dy > 0 ? '올라가면' : '내려가면'} ${floorLabel(v, g.pos[s.id].y) || name}입니다.`, tag: s.t, q: s.e });
    }
  }
  return out.filter((s, i) => i === 0 || s.text !== out[i - 1].text);
}
