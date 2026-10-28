// Three.js 장면 구성: 층판·외벽(반투명)·방·노드·경로·라벨
import * as THREE from 'three';
import { ROOM_TYPES, NODE_TYPES, DEFAULT_FLOOR_HEIGHT, DEFAULT_Y_SCALE } from './schema.js';
import { centroid, bbox } from './geom.js';
import { frameOf } from './camera.js';

const OPACITY = {
  wallActive: 0.22, wallIdle: 0.06,
  slabActive: 0.55, slabIdle: 0.12,
  roomActive: 0.85, roomIdle: 0.05,
};

export function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** [x,z] 폴리곤 → three Shape (x, -z). 메시를 rotation.x=-PI/2 하면 압출 방향이 +y */
function shapeOf(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}

function extrude(poly, depth) {
  return new THREE.ExtrudeGeometry(shapeOf(poly), { depth, bevelEnabled: false });
}

/** 캔버스 텍스트 스프라이트 */
export function makeLabel(text, { size = 1.6, color = '#111', bg = 'rgba(255,255,255,0.85)', font = 'bold 40px system-ui, sans-serif' } = {}) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28, h = 60;
  c.width = w; c.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((size * w) / h, size, 1);
  sp.renderOrder = 10;
  return sp;
}

export class VenueView {
  constructor(venue, opts = {}) {
    this.v = venue;
    this.yScale = opts.yScale ?? venue.yScale ?? DEFAULT_Y_SCALE;
    this.group = new THREE.Group();
    this.floors = {};        // floorId → { group, walls, slab, rooms:[mesh], labels:[sprite], outline }
    this.roomMeshes = [];
    this.activeFloor = null;
    this.routeObj = null;
    this.highlight = null;
    this.build();
  }

  Y(y) { return y * this.yScale; }

  build() {
    const v = this.v, g = this.group;
    const wallColor = new THREE.Color(cssColor('--wall', '#6b7a90'));
    const slabColor = new THREE.Color(cssColor('--slab', '#9fb3c8'));
    const lineColor = new THREE.Color(cssColor('--line', '#3b4a5e'));

    const sorted = [...v.floors].sort((a, b) => a.y - b.y);
    sorted.forEach((f, i) => {
      const h = f.height || DEFAULT_FLOOR_HEIGHT;
      const fg = new THREE.Group();
      fg.position.y = this.Y(f.y);
      // 바닥판
      const slab = new THREE.Mesh(extrude(f.poly, 0.12), new THREE.MeshStandardMaterial({ color: slabColor, transparent: true, opacity: OPACITY.slabIdle, depthWrite: false }));
      slab.rotation.x = -Math.PI / 2; fg.add(slab);
      // 외벽 (반투명 압출)
      const walls = new THREE.Mesh(extrude(f.poly, this.Y(h) - 0.12), new THREE.MeshStandardMaterial({ color: wallColor, transparent: true, opacity: OPACITY.wallIdle, depthWrite: false, side: THREE.DoubleSide }));
      walls.rotation.x = -Math.PI / 2; walls.position.y = 0.12; fg.add(walls);
      // 외곽선
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(walls.geometry, 30), new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.55 }));
      outline.rotation.x = -Math.PI / 2; outline.position.y = 0.12; fg.add(outline);
      // 방
      const rooms = [], labels = [];
      for (const r of v.rooms.filter((r) => r.floor === f.id)) {
        const t = ROOM_TYPES[r.type] || ROOM_TYPES.other;
        const rh = Math.min(2.6, h * 0.65);
        const m = new THREE.Mesh(extrude(r.poly, this.Y(rh)), new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color), transparent: true, opacity: OPACITY.roomIdle, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.y = 0.13;
        m.userData.room = r;
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), new THREE.LineBasicMaterial({ color: new THREE.Color(t.color), transparent: true, opacity: 0.0 }));
        e.rotation.x = -Math.PI / 2; e.position.y = 0.13; m.userData.edges = e;
        fg.add(m); fg.add(e); rooms.push(m); this.roomMeshes.push(m);
        const [cx, cz] = centroid(r.poly);
        const lab = makeLabel(r.no || r.name || '', { size: 1.4 });
        lab.position.set(cx, this.Y(rh) + 1.0, cz); lab.visible = false; lab.userData.room = r;
        fg.add(lab); labels.push(lab);
      }
      // 층 이름표 (외곽 왼쪽 위 모서리)
      const bb = bbox([f.poly]);
      const fl = makeLabel(f.label || f.id, { size: 1.6, bg: 'rgba(30,40,60,0.8)', color: '#fff' });
      fl.position.set(bb.minX - 4, 0.6, bb.maxZ); fl.userData.floorLabel = f.id;
      fg.add(fl);
      g.add(fg);
      this.floors[f.id] = { f, group: fg, slab, walls, outline, rooms, labels, floorLabel: fl };
    });

    // 노드: 출입구 핀, 엘리베이터 샤프트, 계단 플라이트
    this.nodeGroup = new THREE.Group(); g.add(this.nodeGroup);
    const byKey = {};
    for (const [id, n] of Object.entries(v.nodes)) {
      const t = NODE_TYPES[n.type] || NODE_TYPES.corridor;
      if (n.type === 'entrance') this.addEntrance(id, n, t.color);
      else if (n.type === 'elevator' || n.type === 'stair_landing') {
        // 같은 x,z의 노드들을 묶어 수직 동선 하나
        const k = `${n.type}:${n.p[0].toFixed(1)},${n.p[2].toFixed(1)}`;
        (byKey[k] = byKey[k] || { t: n.type, x: n.p[0], z: n.p[2], ys: [], color: t.color, label: n.label }).ys.push(n.p[1]);
      }
    }
    for (const c of Object.values(byKey)) {
      const ys = [...new Set(c.ys)].sort((a, b) => a - b);
      if (c.t === 'elevator') this.addElevator(c, ys); else this.addStairs(c, ys);
    }

    // 바닥 그리드 (가장 낮은 층 아래)
    const lowest = sorted.length ? this.Y(sorted[0].y) - 0.3 : 0;
    const all = bbox(v.floors.map((f) => f.poly));
    const span = Math.max(all.maxX - all.minX, all.maxZ - all.minZ) * 1.6 || 50;
    const grid = new THREE.GridHelper(span, Math.round(span / 5), lineColor, lineColor);
    grid.material.transparent = true; grid.material.opacity = 0.12;
    grid.position.set((all.minX + all.maxX) / 2 || 0, lowest, (all.minZ + all.maxZ) / 2 || 0);
    g.add(grid);
  }

  /** 층 y 목록에서 다음 층까지의 실제 높이 */
  floorGap(y) {
    const ys = this.v.floors.map((f) => f.y).sort((a, b) => a - b);
    const i = ys.indexOf(y);
    if (i >= 0 && i < ys.length - 1) return ys[i + 1] - y;
    const f = this.v.floors.find((f) => f.y === y);
    return (f && f.height) || DEFAULT_FLOOR_HEIGHT;
  }

  /** 출입구: 바닥 링 + 핀 + 이름표 */
  addEntrance(id, n, color) {
    const col = new THREE.Color(color), y = this.Y(n.p[1]);
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.7, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = y + 0.2; grp.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8), new THREE.MeshStandardMaterial({ color: col }));
    pole.position.y = y + 1.6; grp.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 16), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25 }));
    head.position.y = y + 3.4; grp.add(head);
    const lab = makeLabel(n.label || '출입구', { size: 1.4, bg: 'rgba(46,158,91,0.92)', color: '#fff' });
    lab.position.y = y + 5.0; grp.add(lab);
    grp.position.set(n.p[0], 0, n.p[2]); grp.userData.node = id;
    this.nodeGroup.add(grp);
  }

  /** 엘리베이터: 반투명 샤프트 + 층마다 문 + 꼭대기 라벨 */
  addElevator(c, ys) {
    const col = new THREE.Color(c.color);
    const y0 = ys[0], y1 = ys[ys.length - 1] + this.floorGap(ys[ys.length - 1]);
    const h = this.Y(y1 - y0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 2.4), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false }));
    shaft.position.set(c.x, this.Y(y0) + h / 2, c.z); this.nodeGroup.add(shaft);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shaft.geometry), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
    edges.position.copy(shaft.position); this.nodeGroup.add(edges);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: col, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 });
    for (const y of ys) {
      const dh = this.Y(Math.min(2.2, this.floorGap(y) * 0.55));
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, dh, 0.12), doorMat);
      door.position.set(c.x, this.Y(y) + dh / 2 + 0.05, c.z + 1.26); this.nodeGroup.add(door);
      const split = new THREE.Mesh(new THREE.BoxGeometry(0.06, dh, 0.14), new THREE.MeshBasicMaterial({ color: col }));
      split.position.copy(door.position); this.nodeGroup.add(split);
    }
    const lab = makeLabel('EV', { size: 1.3, bg: 'rgba(123,90,214,0.92)', color: '#fff' });
    lab.position.set(c.x, this.Y(y1) + 1.0, c.z); this.nodeGroup.add(lab);
  }

  /** 계단: 층 사이마다 단을 쌓은 플라이트 (x 방향으로 오르는 직선 계단) */
  addStairs(c, ys) {
    const col = new THREE.Color(c.color);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 });
    const steps = 10, run = 3.2, width = 2.4, tread = run / steps;
    // 노드가 찍힌 최저층~최고층 사이의 모든 층에 플라이트를 그린다 (중간 층 노드가 아직 없어도 계단은 이어진다)
    const lo = ys[0], hi = ys[ys.length - 1];
    const floorYs = this.v.floors.map((f) => f.y).filter((y) => y >= lo - 0.01 && y <= hi + 0.01).sort((a, b) => a - b);
    const spans = (floorYs.length ? floorYs : ys).map((y) => [y, y + this.floorGap(y)]);
    for (const [ya, yb] of spans) {
      const rise = this.Y(yb - ya) / steps;
      for (let i = 0; i < steps; i++) {
        const hgt = rise * (i + 1);
        const m = new THREE.Mesh(new THREE.BoxGeometry(tread, hgt, width), mat);
        m.position.set(c.x - run / 2 + tread * (i + 0.5), this.Y(ya) + hgt / 2, c.z);
        this.nodeGroup.add(m);
      }
    }
    // 계단실 외곽선
    const y0 = spans[0][0], y1 = spans[spans.length - 1][1], h = this.Y(y1 - y0);
    const box = new THREE.BoxGeometry(run + 0.6, h, width + 0.6);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
    edges.position.set(c.x, this.Y(y0) + h / 2, c.z); this.nodeGroup.add(edges);
    const lab = makeLabel(c.label || '계단', { size: 1.3, bg: 'rgba(217,130,43,0.92)', color: '#fff' });
    lab.position.set(c.x, this.Y(y1) + 1.0, c.z); this.nodeGroup.add(lab);
  }

  /** 선택 층 강조. null이면 전체 균일 */
  setActiveFloor(id) {
    this.activeFloor = id;
    for (const [fid, F] of Object.entries(this.floors)) {
      const on = id === null || fid === id;
      const dim = id !== null && fid !== id;
      F.walls.material.opacity = on && id !== null ? OPACITY.wallActive : OPACITY.wallIdle;
      F.slab.material.opacity = on && id !== null ? OPACITY.slabActive : OPACITY.slabIdle;
      F.outline.material.opacity = dim ? 0.25 : 0.7;
      for (const m of F.rooms) { m.material.opacity = on && id !== null ? OPACITY.roomActive : OPACITY.roomIdle; m.userData.edges.material.opacity = on && id !== null ? 0.9 : 0; }
      for (const l of F.labels) l.visible = on && id !== null && F.rooms.length <= 80;
      F.floorLabel.material.opacity = dim ? 0.35 : 1;
    }
  }

  /** 방 강조(검색 결과·클릭) */
  highlightRoom(roomId) {
    if (this.highlight) { this.highlight.material.emissive.set(0x000000); this.highlight = null; }
    const m = this.roomMeshes.find((m) => m.userData.room.id === roomId);
    if (m) { m.material.emissive.set(0x335577); this.highlight = m; }
    return m;
  }

  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.roomMeshes, false);
    const F = this.activeFloor;
    const h = hits.find((h) => F === null || h.object.userData.room.floor === F) || hits[0];
    return h ? h.object.userData.room : null;
  }

  /** 경로 표시. route = routeToRoom() 결과 */
  setRoute(route) {
    if (this.routeObj) { this.group.remove(this.routeObj); this.routeObj = null; }
    if (!route) return;
    const pts = route.path.map((s) => { const p = route.g.pos[s.id]; return new THREE.Vector3(p.x, this.Y(p.y) + 0.6, p.z); });
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 12), 0.35, 8, false), new THREE.MeshStandardMaterial({ color: new THREE.Color(cssColor('--route', '#ff5a36')), emissive: 0x551100 }));
    tube.renderOrder = 5;
    const grp = new THREE.Group(); grp.add(tube);
    const start = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), new THREE.MeshStandardMaterial({ color: 0x2e9e5b }));
    start.position.copy(pts[0]); grp.add(start);
    const end = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), new THREE.MeshStandardMaterial({ color: 0xff5a36 }));
    end.position.copy(pts[pts.length - 1]); grp.add(end);
    this.routeObj = grp; this.group.add(grp);
    this.routeCurve = curve;
  }

  frame() { return frameOf(this.group, 1.1); }
  frameFloor(id) { const F = this.floors[id]; return F ? frameOf(F.group, 1.3) : this.frame(); }
}

/** 렌더러·조명 기본 세팅 */
export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(-60, 140, 90); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdde6ff, 0.35); fill.position.set(80, 60, -60); scene.add(fill);
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();
  return { renderer, scene, camera, resize };
}
