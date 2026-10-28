// Three.js 장면 구성: 층판·외벽·방·수직동선·경로·라벨
// 보기 규칙(실내지도 서비스 관행): 선택한 층만 또렷하게, 그 위층은 윤곽만, 아래층은 희미하게.
import * as THREE from 'three';
import { ROOM_TYPES, NODE_TYPES, DEFAULT_FLOOR_HEIGHT, DEFAULT_Y_SCALE } from './schema.js';
import { centroid, bbox, area } from './geom.js';
import { frameOf } from './camera.js';

// 층 상태별 불투명도: all(층 선택 없음) / active / below / above
const OP = {
  all:    { slab: 0.40, wall: 0.06, line: 0.45, room: 0.38, edge: 0.0 },
  active: { slab: 0.96, wall: 0.16, line: 0.9,  room: 0.97, edge: 0.6 },
  below:  { slab: 0.22, wall: 0.04, line: 0.22, room: 0.10, edge: 0.0 },
  above:  { slab: 0.03, wall: 0.015, line: 0.10, room: 0.0,  edge: 0.0 },
};
const ROOM_H = 0.55;      // 방 블록 높이(m). 낮게 깔아 지도처럼 보이게

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
const extrude = (polys, depth) => new THREE.ExtrudeGeometry(polys.map(shapeOf), { depth, bevelEnabled: false });
const polysOf = (f) => (f.polys && f.polys.length ? f.polys : [f.poly]);

/** 캔버스 텍스트 스프라이트 (둥근 알약) */
export function makeLabel(text, { size = 1.5, color = '#1b2430', bg = 'rgba(255,255,255,0.94)', border = null, font = '600 36px Pretendard, system-ui, sans-serif' } = {}) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36, h = 60;
  c.width = w; c.height = h;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(2, 2, w - 4, h - 4, 18); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((size * w) / h, size, 1);
  sp.renderOrder = 10;
  return sp;
}

/** 부드러운 바닥 그림자 (방사형 알파 텍스처) */
function softShadow(w, d) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, 'rgba(30,40,60,0.28)'); g.addColorStop(0.6, 'rgba(30,40,60,0.10)'); g.addColorStop(1, 'rgba(30,40,60,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = -1;
  return m;
}

export class VenueView {
  constructor(venue, opts = {}) {
    this.v = venue;
    this.yScale = opts.yScale ?? venue.yScale ?? DEFAULT_Y_SCALE;
    this.group = new THREE.Group();
    this.floors = {};
    this.roomMeshes = [];
    this.activeFloor = null;
    this.typeFilter = null;
    this.routeObj = null;
    this.highlight = null;
    this.build();
  }

  Y(y) { return y * this.yScale; }

  build() {
    const v = this.v, g = this.group;
    const wallColor = new THREE.Color(cssColor('--wall', '#9aa8bb'));
    const slabColor = new THREE.Color(cssColor('--slab', '#f1f4f9'));
    const lineColor = new THREE.Color(cssColor('--line', '#55637a'));

    const sorted = [...v.floors].sort((a, b) => a.y - b.y);
    sorted.forEach((f) => {
      const h = f.height || DEFAULT_FLOOR_HEIGHT;
      const fg = new THREE.Group();
      fg.position.y = this.Y(f.y);
      const polys = polysOf(f);
      const slab = new THREE.Mesh(extrude(polys, 0.15), new THREE.MeshStandardMaterial({ color: slabColor, transparent: true, opacity: OP.all.slab, roughness: 1, depthWrite: false }));
      slab.rotation.x = -Math.PI / 2; fg.add(slab);
      const walls = new THREE.Mesh(extrude(polys, this.Y(h) - 0.15), new THREE.MeshStandardMaterial({ color: wallColor, transparent: true, opacity: OP.all.wall, roughness: 1, depthWrite: false, side: THREE.DoubleSide }));
      walls.rotation.x = -Math.PI / 2; walls.position.y = 0.15; fg.add(walls);
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(walls.geometry, 30), new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: OP.all.line }));
      outline.rotation.x = -Math.PI / 2; outline.position.y = 0.15; fg.add(outline);
      // 바닥 윤곽(두꺼운 느낌을 주는 테두리)
      const slabEdge = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry, 30), new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.5 }));
      slabEdge.rotation.x = -Math.PI / 2; fg.add(slabEdge);

      const rooms = [], labels = [];
      for (const r of v.rooms.filter((r) => r.floor === f.id)) {
        const t = ROOM_TYPES[r.type] || ROOM_TYPES.other;
        const col = new THREE.Color(t.color);
        const m = new THREE.Mesh(extrude([r.poly], this.Y(ROOM_H)), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: OP.all.room, roughness: 0.95, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.y = 0.16;
        m.userData.room = r; m.userData.area = area(r.poly);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), new THREE.LineBasicMaterial({ color: new THREE.Color(t.ink), transparent: true, opacity: 0 }));
        e.rotation.x = -Math.PI / 2; e.position.y = 0.16; m.userData.edges = e;
        fg.add(m); fg.add(e); rooms.push(m); this.roomMeshes.push(m);
        const [cx, cz] = centroid(r.poly);
        const lab = makeLabel(r.no || r.name || '', { size: 1.25, color: t.ink });
        lab.position.set(cx, this.Y(ROOM_H) + 0.9, cz); lab.visible = false;
        lab.userData.room = r; lab.userData.area = m.userData.area;
        fg.add(lab); labels.push(lab);
      }
      const bb = bbox(polys);
      const fl = makeLabel(f.label || f.id, { size: 1.6, bg: 'rgba(27,36,48,0.85)', color: '#fff' });
      fl.position.set(bb.minX - 4, 0.8, bb.maxZ);
      fg.add(fl);
      g.add(fg);
      this.floors[f.id] = { f, group: fg, slab, walls, outline, slabEdge, rooms, labels, floorLabel: fl };
    });

    // 수직 동선·출입구
    this.nodeGroup = new THREE.Group(); g.add(this.nodeGroup);
    this.inst = {}; this.coreLabels = [];
    const byKey = {};
    for (const [id, n] of Object.entries(v.nodes)) {
      const t = NODE_TYPES[n.type] || NODE_TYPES.corridor;
      if (n.type === 'entrance') this.addEntrance(id, n, t.color);
      else if (n.type === 'elevator' || n.type === 'stair_landing') {
        const k = `${n.type}:${n.p[0].toFixed(1)},${n.p[2].toFixed(1)}`;
        (byKey[k] = byKey[k] || { t: n.type, x: n.p[0], z: n.p[2], ys: [], color: t.color, label: n.label }).ys.push(n.p[1]);
      }
    }
    for (const c of Object.values(byKey)) {
      const ys = [...new Set(c.ys)].sort((a, b) => a - b);
      if (c.t === 'elevator') this.addElevator(c, ys); else this.addStairs(c, ys);
    }
    this.flushInstances();

    // 바닥 그림자
    const all = bbox(v.floors.flatMap(polysOf));
    const lowest = sorted.length ? this.Y(sorted[0].y) - 0.4 : 0;
    const sh = softShadow((all.maxX - all.minX) * 1.9, (all.maxZ - all.minZ) * 1.9);
    sh.position.set((all.minX + all.maxX) / 2, lowest, (all.minZ + all.maxZ) / 2);
    g.add(sh);
    this.bounds = all;
  }

  floorGap(y) {
    const ys = this.v.floors.map((f) => f.y).sort((a, b) => a - b);
    const i = ys.indexOf(y);
    if (i >= 0 && i < ys.length - 1) return ys[i + 1] - y;
    const f = this.v.floors.find((f) => f.y === y);
    return (f && f.height) || DEFAULT_FLOOR_HEIGHT;
  }

  addEntrance(id, n, color) {
    const col = new THREE.Color(color), y = this.Y(n.p[1]);
    const grp = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.8, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = y + 0.25; grp.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), new THREE.MeshStandardMaterial({ color: col }));
    pole.position.y = y + 1.7; grp.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.65, 20, 20), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3 }));
    head.position.y = y + 3.6; grp.add(head);
    const lab = makeLabel(n.label || '출입구', { size: 1.4, bg: 'rgba(46,158,91,0.94)', color: '#fff' });
    lab.position.y = y + 5.2; grp.add(lab);
    grp.position.set(n.p[0], 0, n.p[2]); grp.userData.node = id;
    this.nodeGroup.add(grp);
  }

  addElevator(c, ys) {
    const col = new THREE.Color(c.color);
    const y0 = ys[0], y1 = ys[ys.length - 1] + this.floorGap(ys[ys.length - 1]);
    const h = this.Y(y1 - y0);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.4, h, 2.4), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false }));
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
    const lab = makeLabel('EV', { size: 1.3, bg: 'rgba(123,90,214,0.94)', color: '#fff' });
    lab.position.set(c.x, this.Y(y1) + 1.0, c.z); this.nodeGroup.add(lab);
    this.coreLabels.push({ lab, ys, top: y1, x: c.x, z: c.z });
  }

  /** 인스턴스 박스 예약. span = 이 조각이 속한 층의 실제 y (층 선택 때 위층 조각을 숨기기 위해) */
  box(kind, span, x, y, z, sx, sy, sz, rotZ = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotZ)), new THREE.Vector3(sx, sy, sz));
    const k = `${kind}|${span}`;
    (this.inst[k] = this.inst[k] || []).push(m);
  }
  flushInstances() {
    const mats = {
      tread: new THREE.MeshStandardMaterial({ color: 0xf8dcb4, roughness: 0.6 }),
      slab: new THREE.MeshStandardMaterial({ color: 0xe39a55, roughness: 0.75 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 0.4, metalness: 0.3 }),
    };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    this.spanMeshes = [];   // { y, mesh } — 층 선택 때 위층 것 숨김
    for (const [k, list] of Object.entries(this.inst)) {
      if (!list.length) continue;
      const [kind, span] = k.split('|');
      const im = new THREE.InstancedMesh(unit, mats[kind], list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      this.nodeGroup.add(im);
      this.spanMeshes.push({ y: parseFloat(span), mesh: im });
    }
  }

  /** ㄷ자 꺾임계단: 올라갈 때 +x → 랜딩 → -x (위에서 보면 반시계, 내려갈 때 시계방향) */
  addStairs(c, ys) {
    const col = new THREE.Color(c.color);
    const W = 1.3, run = 3.3, landing = 1.4, T = 0.1, n = 12;
    const tread = run / n, x0 = c.x - (run + landing) / 2;
    const lo = ys[0], hi = ys[ys.length - 1];
    const floorYs = this.v.floors.map((f) => f.y).filter((y) => y >= lo - 0.01 && y <= hi + 0.01).sort((a, b) => a - b);
    const spans = (floorYs.length ? floorYs : ys).map((y) => [y, y + this.floorGap(y)]);
    for (const [ya, yb] of spans) {
      const H = this.Y(yb - ya), rise = H / (2 * n), base = this.Y(ya);
      const zA = c.z + W / 2, zB = c.z - W / 2;
      for (let i = 0; i < n; i++) this.box('tread', ya, x0 + tread * (i + 0.5), base + rise * (i + 1), zA, tread * 0.92, T, W);
      this.box('slab', ya, x0 + run + landing / 2, base + rise * n - T / 2, c.z, landing, T * 1.5, 2 * W);
      for (let i = 0; i < n; i++) this.box('tread', ya, x0 + run - tread * (i + 0.5), base + rise * (n + i + 1), zB, tread * 0.92, T, W);
      const len = Math.hypot(run, rise * n), ang = Math.atan2(rise * n, run);
      const midA = [x0 + run / 2, base + rise * n / 2 - 0.2], midB = [x0 + run / 2, base + rise * n * 1.5 - 0.2];
      this.box('slab', ya, midA[0], midA[1], zA, len, 0.14, W, ang);
      this.box('slab', ya, midB[0], midB[1], zB, len, 0.14, W, -ang);
      this.box('rail', ya, midA[0], midA[1] + 1.1, zA + W / 2, len, 0.05, 0.05, ang);
      this.box('rail', ya, midB[0], midB[1] + 1.1, zB - W / 2, len, 0.05, 0.05, -ang);
      this.box('rail', ya, midA[0], midA[1] + 1.1, c.z + 0.03, len, 0.05, 0.05, ang);
      this.box('rail', ya, midB[0], midB[1] + 1.1, c.z - 0.03, len, 0.05, 0.05, -ang);
      this.box('rail', ya, x0 + run + landing - 0.05, base + rise * n + 0.55, c.z, 0.05, 1.1, 2 * W);
    }
    const y0 = spans[0][0], y1 = spans[spans.length - 1][1], h = this.Y(y1 - y0);
    const shaft = new THREE.BoxGeometry(run + landing + 0.5, h, 2 * W + 0.5);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shaft), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.45 }));
    edges.position.set(c.x, this.Y(y0) + h / 2, c.z); this.nodeGroup.add(edges);
    const lab = makeLabel(c.label || '계단', { size: 1.3, bg: 'rgba(217,130,43,0.94)', color: '#fff' });
    lab.position.set(c.x, this.Y(y1) + 1.0, c.z); this.nodeGroup.add(lab);
    this.coreLabels.push({ lab, ys, top: y1, x: c.x, z: c.z });
  }

  /** 층 선택에 맞춰 수직 동선 표시: 위층 계단 조각 숨김, 계단·EV 이름표를 그 층 높이로 */
  updateVertical(activeY) {
    for (const s of this.spanMeshes || []) s.mesh.visible = activeY === null || s.y <= activeY + 0.01;
    for (const c of this.coreLabels || []) {
      const on = activeY === null || c.ys.some((y) => Math.abs(y - activeY) < 0.01) || (c.ys[0] < activeY && c.top > activeY);
      c.lab.visible = on;
      const yLab = activeY === null ? this.Y(c.top) + 1.0 : this.Y(activeY) + this.Y(DEFAULT_FLOOR_HEIGHT) * 0.75;
      c.lab.position.set(c.x, yLab, c.z);
    }
  }

  /** 층 선택. null이면 전체 균일 */
  setActiveFloor(id) {
    this.activeFloor = id;
    const ay = id ? this.floors[id].f.y : null;
    for (const [fid, F] of Object.entries(this.floors)) {
      const st = id === null ? 'all' : fid === id ? 'active' : F.f.y < ay ? 'below' : 'above';
      const o = OP[st];
      F.slab.material.opacity = o.slab; F.walls.material.opacity = o.wall;
      F.outline.material.opacity = o.line; F.slabEdge.material.opacity = st === 'active' ? 0.9 : st === 'above' ? 0.08 : 0.35;
      F.slab.material.color.set(cssColor(st === 'active' ? '--slab-active' : '--slab', '#f1f4f9'));
      for (const m of F.rooms) { m.visible = o.room > 0; m.userData.edges.visible = o.edge > 0; m.userData.edges.material.opacity = o.edge; }
      F.floorLabel.visible = st === 'all' || st === 'active';   // 층 알약 UI가 있으니 3D 이름표는 활성 층(또는 전체 보기)만
      F.floorLabel.material.opacity = st === 'all' ? 0.7 : 1;
      F._state = st;
    }
    this.applyRoomOpacity();
    this.updateVertical(ay);
  }

  /** 종류 필터 (null이면 전부) */
  setTypeFilter(type) { this.typeFilter = type; this.applyRoomOpacity(); }

  applyRoomOpacity() {
    for (const F of Object.values(this.floors)) {
      const base = OP[F._state || 'all'].room;
      for (const m of F.rooms) {
        const r = m.userData.room;
        const dim = this.typeFilter && r.type !== this.typeFilter;
        m.material.opacity = dim ? base * 0.18 : base;
        m.userData.edges.material.opacity = dim ? 0 : OP[F._state || 'all'].edge;
      }
    }
  }

  /** 카메라 거리에 따라 라벨 표시 (활성 층만). r: 궤도 반지름 */
  updateLabels(r) {
    const F = this.activeFloor ? this.floors[this.activeFloor] : null;
    for (const G of Object.values(this.floors)) if (G !== F) for (const l of G.labels) l.visible = false;
    if (!F) return;
    const minArea = r < 60 ? 0 : r < 110 ? 18 : r < 180 ? 45 : 90;
    for (const l of F.labels) {
      const r0 = l.userData.room;
      const pass = !this.typeFilter || r0.type === this.typeFilter;
      l.visible = pass && (l.userData.area >= minArea || (this.highlight && this.highlight.userData.room.id === r0.id));
    }
  }

  highlightRoom(roomId) {
    if (this.highlight) { this.highlight.material.emissive.set(0x000000); this.highlight.scale.z = 1; this.highlight = null; }
    const m = this.roomMeshes.find((m) => m.userData.room.id === roomId);
    if (m) { m.material.emissive.set(0x2244aa); m.material.emissiveIntensity = 0.35; m.scale.z = 2.2; this.highlight = m; }
    return m;
  }

  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.roomMeshes.filter((m) => m.visible), false);
    const F = this.activeFloor;
    const h = hits.find((h) => F === null || h.object.userData.room.floor === F) || hits[0];
    return h ? h.object.userData.room : null;
  }

  setRoute(route) {
    if (this.routeObj) { this.group.remove(this.routeObj); this.routeObj = null; }
    if (!route) return;
    const pts = route.path.map((s) => { const p = route.g.pos[s.id]; return new THREE.Vector3(p.x, this.Y(p.y) + 0.9, p.z); });
    if (pts.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
    const col = new THREE.Color(cssColor('--route', '#ff5a36'));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 12), 0.38, 10, false), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.5 }));
    tube.renderOrder = 5;
    const grp = new THREE.Group(); grp.add(tube);
    const start = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 20), new THREE.MeshStandardMaterial({ color: 0x2e9e5b }));
    start.position.copy(pts[0]); grp.add(start);
    const end = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 20), new THREE.MeshStandardMaterial({ color: col }));
    end.position.copy(pts[pts.length - 1]); grp.add(end);
    this.routeObj = grp; this.group.add(grp);
    this.routeCurve = curve;
  }

  frame() { return frameOf(this.group, 1.05); }
  frameFloor(id) { const F = this.floors[id]; return F ? frameOf(F.group, 1.25) : this.frame(); }
}

/** 렌더러·조명 기본 세팅 */
export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4d4, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(-80, 160, 110); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xe8eeff, 0.35); fill.position.set(90, 60, -80); scene.add(fill);
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  addEventListener('resize', resize); resize();
  return { renderer, scene, camera, resize };
}
