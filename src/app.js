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
let view = null, venue = null, index = [], meta = null;
let activeFloor = null, selectedRoom = null, route = null, typeFilter = null, routeOpen = false;

// ---------- 데이터 ----------
async function loadIndex() {
  index = await (await fetch('data/index.json')).json();
  const sel = $('#building');
  sel.innerHTML = index.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
  const want = params.get('b') || index[0]?.id;
  if (want) { sel.value = want; await loadVenue(want); }
}

async function loadVenue(id) {
  meta = index.find((b) => b.id === id);
  if (!meta) return;
  venue = await (await fetch(meta.file)).json();
  if (view) scene.remove(view.group);
  view = new VenueView(venue);
  scene.add(view.group);
  const fr = view.frame(); orbit.jumpTo(fr.t, fr.r);
  selectedRoom = null; route = null; typeFilter = null; routeOpen = false;
  renderFloors(); renderChips();
  $('#editLink').href = `editor.html?b=${venue.id}`;
  const f = params.get('f'), r = params.get('r');
  setFloor(f && venue.floors.some((x) => x.id === f) ? f : null, false);
  const room = r ? venue.rooms.find((x) => x.no === r || x.id === r) : null;
  if (room) selectRoom(room); else showBuildingCard();
  updateLink();
}

// ---------- 층 ----------
function renderFloors() {
  const box = $('#floors');
  const sorted = [...venue.floors].sort((a, b) => b.y - a.y);
  let html = `<button data-f="">전체</button><button class="sep" tabindex="-1"></button>`;
  html += sorted.map((f) => `<button data-f="${f.id}">${(f.label || f.id).replace('지하 ', 'B').replace('층', '')}</button>`).join('');
  box.innerHTML = html;
  box.querySelectorAll('button[data-f]').forEach((b) => { b.title = b.dataset.f ? venue.floors.find((f) => f.id === b.dataset.f).label : '모든 층'; b.addEventListener('click', () => setFloor(b.dataset.f || null)); });
}

function setFloor(id, moveCamera = true) {
  activeFloor = id;
  view.setActiveFloor(id);
  $('#floors').querySelectorAll('button[data-f]').forEach((b) => b.classList.toggle('on', (b.dataset.f || null) === id));
  if (moveCamera) { const fr = id ? view.frameFloor(id) : view.frame(); orbit.frameTo(fr.t, fr.r); }
  if ($('#search').value || typeFilter) renderResults();
  updateLink();
}

// ---------- 검색 / 필터 ----------
function searchRooms(q) {
  q = q.trim().toLowerCase();
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
  let rooms = venue.rooms;
  if (typeFilter) rooms = rooms.filter((r) => r.type === typeFilter);
  if (q) {
    const qq = q.replace(/\s+/g, '');
    rooms = rooms.filter((r) => norm(r.no).includes(qq) || norm(r.name).includes(qq) || (r.aliases || []).some((a) => norm(a).includes(qq)));
    rooms.sort((a, b) => (norm(a.no).startsWith(qq) ? 0 : 1) - (norm(b.no).startsWith(qq) ? 0 : 1) || a.no.localeCompare(b.no, 'ko', { numeric: true }));
  } else if (activeFloor) rooms = rooms.filter((r) => r.floor === activeFloor);
  return rooms;
}

function renderResults() {
  const q = $('#search').value;
  const list = $('#results');
  $('#clear').classList.toggle('on', !!q);
  if (!q && !typeFilter) { list.hidden = true; return; }
  const rooms = searchRooms(q).slice(0, 80);
  list.hidden = false;
  list.innerHTML = rooms.map((r) => {
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.other;
    const fl = venue.floors.find((f) => f.id === r.floor);
    return `<li data-id="${r.id}" class="${selectedRoom?.id === r.id ? 'on' : ''}"><span class="dot" style="background:${t.color}"></span><span class="no">${r.no || ''}</span><span class="nm">${r.name || '<span class="muted">이름 없음</span>'}</span><small>${fl?.label || r.floor}</small></li>`;
  }).join('') || `<li class="empty">결과가 없습니다${activeFloor && !q ? ` (${venue.floors.find((f) => f.id === activeFloor)?.label})` : ''}</li>`;
  list.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => { selectRoom(venue.rooms.find((r) => r.id === li.dataset.id)); }));
}

function renderChips() {
  const types = [...new Set(venue.rooms.map((r) => r.type || 'other'))];
  const order = Object.keys(ROOM_TYPES).filter((k) => types.includes(k));
  $('#chips').innerHTML = order.map((k) => `<button data-type="${k}"><i style="background:${ROOM_TYPES[k].color}"></i>${ROOM_TYPES[k].ko}</button>`).join('') +
    `<button data-type="" title="수직 동선"><i style="background:${NODE_TYPES.stair_landing.color}"></i>계단</button><button data-type="" title="수직 동선"><i style="background:${NODE_TYPES.elevator.color}"></i>EV</button>`;
  $('#chips').querySelectorAll('button[data-type]').forEach((b) => b.addEventListener('click', () => {
    if (!b.dataset.type) return;
    typeFilter = typeFilter === b.dataset.type ? null : b.dataset.type;
    $('#chips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', !!x.dataset.type && x.dataset.type === typeFilter));
    view.setTypeFilter(typeFilter);
    renderResults();
  }));
}

// ---------- 카드 ----------
function showBuildingCard() {
  if (embed) { $('#card').hidden = true; return; }
  const est = Math.round((meta.estRatio ?? 0) * 100);
  const facts = venue.facts || {};
  $('#card').hidden = false;
  $('#card').innerHTML = `
    <h2>${venue.name}<small class="muted">${venue.campus || ''}</small></h2>
    <div class="tags"><span class="tag">층 ${venue.floors.length}</span><span class="tag">방 ${venue.rooms.length}</span>${est ? `<span class="tag est">추정 ${est}%</span>` : ''}${venue.source?.checked ? `<span class="tag">확인 ${venue.source.checked}</span>` : ''}</div>
    <div class="hint">층 버튼을 누르면 그 층만 또렷하게 보입니다. 방을 클릭하거나 위에서 검색하세요.</div>
    <details style="margin-top:8px"><summary>확인한 것 / 추정한 것</summary><ul id="facts">${(facts.ok || []).map((t) => `<li class="ok">${t}</li>`).join('')}${(facts.est || []).map((t) => `<li class="est">${t}</li>`).join('')}</ul></details>
    <div class="hint">데이터는 공개 도면을 보고 손으로 그린 것이라 오차가 있습니다. "추정" 표시는 현장 확인 전입니다. <a href="https://github.com/buildtwenty/campus-nav" style="color:var(--accent)">GitHub</a></div>`;
}

function selectRoom(room) {
  selectedRoom = room;
  if (!room) { view.highlightRoom(null); showBuildingCard(); updateLink(); return; }
  if (activeFloor !== room.floor) setFloor(room.floor, false);
  const m = view.highlightRoom(room.id);
  if (m) { const b = new THREE.Box3().setFromObject(m); const c = b.getCenter(new THREE.Vector3()); orbit.frameTo(c, Math.min(Math.max(45, orbit.o.r * 0.55), 110)); }
  renderRoomCard();
  renderResults();
  updateLink();
}

function renderRoomCard() {
  const room = selectedRoom, t = ROOM_TYPES[room.type] || ROOM_TYPES.other;
  const fl = venue.floors.find((f) => f.id === room.floor);
  const ents = Object.entries(venue.nodes).filter(([, n]) => n.type === 'entrance');
  $('#card').hidden = false;
  $('#card').innerHTML = `
    <button class="close" aria-label="닫기">×</button>
    <h2>${room.no || '?'}<small class="muted">${fl?.label || ''}</small></h2>
    <div class="name">${room.name || '<span class="muted">이름 없음</span>'}</div>
    <div class="tags"><span class="tag type" style="background:${t.ink}">${t.ko}</span>${room.est ? '<span class="tag est">위치 어림</span>' : ''}${room.note ? `<span class="tag">${room.note}</span>` : ''}</div>
    <div class="btns">${ents.length ? `<button id="goBtn" class="primary">길찾기</button>` : ''}<button id="shareBtn">링크 복사</button></div>
    ${ents.length ? `<div id="route" ${routeOpen ? '' : 'hidden'}>
      <div class="row"><select id="fromEnt"><option value="">가장 가까운 출입구에서</option>${ents.map(([id, n]) => `<option value="${id}">${n.label || id}에서</option>`).join('')}</select></div>
      <label><input type="checkbox" id="noStairs"> 계단 없이 (엘리베이터만)</label>
      <ol id="steps"></ol></div>` : ''}`;
  $('#card .close').addEventListener('click', () => { route = null; view.setRoute(null); routeOpen = false; selectRoom(null); });
  $('#shareBtn').addEventListener('click', copyLink);
  $('#goBtn')?.addEventListener('click', () => { routeOpen = true; $('#route').hidden = false; runRoute(); });
  $('#fromEnt')?.addEventListener('change', runRoute);
  $('#noStairs')?.addEventListener('change', runRoute);
  if (routeOpen) runRoute();
}

function runRoute() {
  const room = selectedRoom; if (!room) return;
  route = routeToRoom(venue, $('#fromEnt').value || null, room, { noStairs: $('#noStairs').checked });
  view.setRoute(route);
  const steps = describe(venue, route);
  $('#steps').innerHTML = steps.map((s) => `<li class="${s.tag || ''}">${s.text}${s.q ? ' <span class="tag est">추정</span>' : ''}</li>`).join('');
  if (route) { setFloor(null, false); const fr = view.frame(); orbit.frameTo(fr.t, fr.r * 0.9); }
}

// ---------- 링크 ----------
function updateLink() {
  const u = new URL(location.href);
  u.searchParams.set('b', venue.id);
  activeFloor ? u.searchParams.set('f', activeFloor) : u.searchParams.delete('f');
  selectedRoom ? u.searchParams.set('r', selectedRoom.no || selectedRoom.id) : u.searchParams.delete('r');
  history.replaceState(null, '', u);
}
async function copyLink(e) {
  const btn = e.currentTarget, old = btn.textContent;
  try { await navigator.clipboard.writeText(location.href); btn.textContent = '복사됨 ✓'; setTimeout(() => (btn.textContent = old), 1200); } catch { prompt('링크', location.href); }
}

// ---------- 이벤트 ----------
$('#building').addEventListener('change', (e) => { history.replaceState(null, '', `?b=${e.target.value}`); loadVenue(e.target.value); });
$('#search').addEventListener('input', renderResults);
$('#search').addEventListener('focus', renderResults);
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = $('#results li[data-id]'); if (first) first.click(); } if (e.key === 'Escape') { $('#search').value = ''; renderResults(); e.target.blur(); } });
$('#clear').addEventListener('click', () => { $('#search').value = ''; renderResults(); $('#search').focus(); });
$('#share').addEventListener('click', copyLink);
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => orbit.setView(b.dataset.view)));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#top')) { if (!$('#search').value && !typeFilter) $('#results').hidden = true; } });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.target.matches('input')) { if (selectedRoom) { route = null; view.setRoute(null); routeOpen = false; selectRoom(null); } } });

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

// 나침반: 북쪽(-z)이 화면에서 가리키는 방향
const compass = $('#compass svg'), vA = new THREE.Vector3(), vB = new THREE.Vector3();
function updateCompass() {
  if (!compass) return;
  vA.copy(orbit.o.t).project(camera); vB.copy(orbit.o.t).add(new THREE.Vector3(0, 0, -10)).project(camera);
  const ang = Math.atan2(-(vB.y - vA.y), vB.x - vA.x) * 180 / Math.PI + 90;
  compass.style.transform = `rotate(${ang}deg)`;
}

function loop() { orbit.update(); if (view) { view.updateLabels(orbit.o.r); updateCompass(); } renderer.render(scene, camera); requestAnimationFrame(loop); }
loadIndex().then(loop).catch((e) => { console.error(e); alert('데이터를 불러오지 못했습니다: ' + e.message); });
