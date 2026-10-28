// 뷰어 진입점 (index.html)
import * as THREE from 'three';
import { createStage, VenueView } from './render.js';
import { createOrbit } from './camera.js';
import { routeToRoom } from './route.js';
import { describe } from './describe.js';
import { ROOM_TYPES, NODE_TYPES } from './schema.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const embed = params.get('embed') === '1';
if (embed) document.body.classList.add('embed');

const canvas = $('#view');
const { renderer, scene, camera } = createStage(canvas);
const orbit = createOrbit(camera, canvas);
let view = null, venue = null, index = [];
let activeFloor = null, selectedRoom = null, route = null;

// ---------- 데이터 ----------
async function loadIndex() {
  index = await (await fetch('data/index.json')).json();
  const sel = $('#building');
  sel.innerHTML = index.map((b) => `<option value="${b.id}">${b.name}${b.campus ? ` · ${b.campus}` : ''}</option>`).join('');
  const want = params.get('b') || index[0]?.id;
  if (want) { sel.value = want; await loadVenue(want); }
}

async function loadVenue(id) {
  const meta = index.find((b) => b.id === id);
  if (!meta) return;
  venue = await (await fetch(meta.file)).json();
  if (view) scene.remove(view.group);
  view = new VenueView(venue);
  scene.add(view.group);
  const fr = view.frame(); orbit.jumpTo(fr.t, fr.r);
  renderMeta(meta);
  renderFloors();
  renderRoomList('');
  renderRoutePanel();
  const f = params.get('f'), r = params.get('r');
  setFloor(f && venue.floors.some((x) => x.id === f) ? f : null, false);
  if (r) { const room = venue.rooms.find((x) => x.no === r || x.id === r); if (room) selectRoom(room); }
  updateLink();
}

// ---------- UI ----------
function renderMeta(meta) {
  $('#title').textContent = venue.name;
  const est = Math.round((meta.estRatio ?? 0) * 100);
  $('#meta').innerHTML = `${venue.campus || ''} · 층 ${venue.floors.length} · 방 ${venue.rooms.length}` +
    (est ? ` · <span class="tag est">추정 ${est}%</span>` : '') +
    (venue.source?.checked ? ` · 확인 ${venue.source.checked}` : '');
  const facts = venue.facts || {};
  $('#facts').innerHTML =
    (facts.ok || []).map((t) => `<li class="ok">${t}</li>`).join('') +
    (facts.est || []).map((t) => `<li class="est">${t}</li>`).join('');
  $('#editLink').href = `editor.html?b=${venue.id}`;
}

function renderFloors() {
  const box = $('#floors');
  const sorted = [...venue.floors].sort((a, b) => b.y - a.y);
  box.innerHTML = `<button data-f="" class="${activeFloor === null ? 'on' : ''}">전체</button>` +
    sorted.map((f) => `<button data-f="${f.id}">${f.label || f.id}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setFloor(b.dataset.f || null)));
}

function setFloor(id, moveCamera = true) {
  activeFloor = id;
  view.setActiveFloor(id);
  $('#floors').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.f || null) === id));
  if (moveCamera && id) { const fr = view.frameFloor(id); orbit.frameTo(fr.t, fr.r); }
  renderRoomList($('#search').value);
  updateLink();
}

function renderRoomList(q) {
  const list = $('#rooms');
  q = (q || '').trim().toLowerCase();
  let rooms = venue.rooms.filter((r) => !activeFloor || r.floor === activeFloor);
  if (q) rooms = venue.rooms.filter((r) => (r.no || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
  rooms = rooms.slice(0, 60);
  list.innerHTML = rooms.map((r) => {
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.other;
    const fl = venue.floors.find((f) => f.id === r.floor);
    return `<li data-id="${r.id}" class="${selectedRoom?.id === r.id ? 'on' : ''}"><span class="dot" style="background:${t.color}"></span><b>${r.no || ''}</b> ${r.name || ''}<small>${fl?.label || r.floor}${r.est ? ' · 추정' : ''}</small></li>`;
  }).join('') || '<li class="muted">방 데이터가 없습니다. 편집기에서 추가하세요.</li>';
  list.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => selectRoom(venue.rooms.find((r) => r.id === li.dataset.id))));
}

function selectRoom(room) {
  selectedRoom = room;
  if (!room) { view.highlightRoom(null); $('#roomInfo').hidden = true; updateLink(); return; }
  if (activeFloor !== room.floor) setFloor(room.floor);
  const m = view.highlightRoom(room.id);
  if (m) { const b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3()); orbit.frameTo(c, Math.max(40, orbit.o.r * 0.6)); }
  const t = ROOM_TYPES[room.type] || ROOM_TYPES.other;
  const fl = venue.floors.find((f) => f.id === room.floor);
  $('#roomInfo').hidden = false;
  $('#roomInfo').innerHTML = `<div class="rno">${room.no || '?'}호 <small>${fl?.label || ''} · ${t.ko}</small></div>
    <div class="rname">${room.name || '<span class="muted">이름 없음</span>'}</div>
    ${room.est ? '<div class="tag est">위치 어림 (도면만 보고 추정)</div>' : ''}
    ${room.note ? `<div class="muted">${room.note}</div>` : ''}`;
  $('#toRoom').value = room.id;
  renderRoomList($('#search').value);
  updateLink();
}

function renderRoutePanel() {
  const ents = Object.entries(venue.nodes).filter(([, n]) => n.type === 'entrance');
  $('#routePanel').hidden = !ents.length;
  $('#fromEnt').innerHTML = `<option value="">가장 가까운 출입구</option>` + ents.map(([id, n]) => `<option value="${id}">${n.label || id}</option>`).join('');
  $('#toRoom').innerHTML = `<option value="">도착 방 선택</option>` + venue.rooms.map((r) => `<option value="${r.id}">${r.no} ${r.name || ''}</option>`).join('');
}

function runRoute() {
  const room = venue.rooms.find((r) => r.id === $('#toRoom').value);
  if (!room) return;
  route = routeToRoom(venue, $('#fromEnt').value || null, room, { noStairs: $('#noStairs').checked });
  view.setRoute(route);
  const steps = describe(venue, route);
  $('#steps').innerHTML = steps.map((s) => `<li class="${s.tag || ''}">${s.text}${s.q ? ' <span class="tag est">추정</span>' : ''}</li>`).join('');
  if (route) { setFloor(null, false); const fr = view.frame(); orbit.frameTo(fr.t, fr.r); }
  selectRoom(room);
}

function updateLink() {
  const u = new URL(location.href);
  u.searchParams.set('b', venue.id);
  activeFloor ? u.searchParams.set('f', activeFloor) : u.searchParams.delete('f');
  selectedRoom ? u.searchParams.set('r', selectedRoom.no || selectedRoom.id) : u.searchParams.delete('r');
  history.replaceState(null, '', u);
  $('#share').dataset.url = u.href;
}

// ---------- 이벤트 ----------
$('#building').addEventListener('change', (e) => { history.replaceState(null, '', `?b=${e.target.value}`); loadVenue(e.target.value); });
$('#search').addEventListener('input', (e) => renderRoomList(e.target.value));
$('#go').addEventListener('click', runRoute);
$('#noStairs').addEventListener('change', () => route && runRoute());
$('#share').addEventListener('click', async (e) => {
  const url = e.currentTarget.dataset.url || location.href;
  try { await navigator.clipboard.writeText(url); e.currentTarget.textContent = '복사됨'; setTimeout(() => (e.currentTarget.textContent = '링크 복사'), 1200); } catch { prompt('링크', url); }
});
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => orbit.setView(b.dataset.view)));
$('#panelToggle')?.addEventListener('click', () => document.body.classList.toggle('panel-open'));

// 범례
$('#legend').innerHTML = Object.entries(ROOM_TYPES).filter(([k]) => k !== 'other').map(([, t]) => `<span><i style="background:${t.color}"></i>${t.ko}</span>`).join('') +
  `<span><i style="background:${NODE_TYPES.entrance.color}"></i>출입구</span><span><i style="background:${NODE_TYPES.stair_landing.color}"></i>계단</span><span><i style="background:${NODE_TYPES.elevator.color}"></i>엘리베이터</span>`;

// 클릭으로 방 선택 (드래그와 구분), 마우스 올리면 커서 변경
const rc = new THREE.Raycaster();
function pickAt(e) {
  const rect = canvas.getBoundingClientRect();
  rc.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
  return view ? view.pick(rc) : null;
}
let down = null, hoverPending = false;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !view) return;
  const room = pickAt(e);
  if (room) selectRoom(room);
});
canvas.addEventListener('pointermove', (e) => {
  if (hoverPending || e.pointerType === 'touch') return;
  hoverPending = true;
  requestAnimationFrame(() => { hoverPending = false; const r = pickAt(e); canvas.style.cursor = r ? 'pointer' : ''; canvas.title = r ? `${r.no} ${r.name || ''}` : ''; });
});

function loop() { orbit.update(); renderer.render(scene, camera); requestAnimationFrame(loop); }
loadIndex().then(loop).catch((e) => { $('#meta').textContent = '데이터를 불러오지 못했습니다: ' + e.message; console.error(e); });
