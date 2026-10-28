// 궤도 카메라 + 자동 프레이밍
import * as THREE from 'three';

export const VIEWS = { iso: [3.72, 0.92], top: [3.72, 0.08], side: [3.72, 1.43] };

export function createOrbit(camera, canvas) {
  const o = { theta: 3.72, phi: 0.92, r: 520, t: new THREE.Vector3(), goal: null, goalT: null, goalR: null };
  const ptrs = new Map(); let pinch = 0;
  const zoom = (f) => { o.goalT = null; o.r = Math.min(3000, Math.max(40, o.r * f)); };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); o.goal = null;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId), dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { o.theta += dx * 0.006; o.phi = Math.min(1.54, Math.max(0.06, o.phi - dy * 0.006)); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoom(pinch / d); pinch = d; }
  });
  ['pointerup', 'pointercancel'].forEach((n) => canvas.addEventListener(n, (e) => { ptrs.delete(e.pointerId); pinch = 0; }));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const k = e.key; o.goal = null;
    if (k === 'ArrowLeft') o.theta += 0.12; else if (k === 'ArrowRight') o.theta -= 0.12;
    else if (k === 'ArrowUp') o.phi = Math.max(0.06, o.phi - 0.08); else if (k === 'ArrowDown') o.phi = Math.min(1.54, o.phi + 0.08);
    else if (k === '+' || k === '=') zoom(0.88); else if (k === '-') zoom(1.14); else return;
    e.preventDefault();
  });

  return {
    o,
    setView(v) { o.goal = { theta: VIEWS[v][0], phi: VIEWS[v][1] }; },
    frameTo(t, r) { o.goalT = t.clone(); o.goalR = r; },
    jumpTo(t, r) { o.t.copy(t); o.r = r; o.goalT = null; },
    update() {
      if (o.goalT) {
        o.t.lerp(o.goalT, 0.12); o.r += (o.goalR - o.r) * 0.12;
        if (o.t.distanceTo(o.goalT) < 0.5 && Math.abs(o.goalR - o.r) < 1) o.goalT = null;
      }
      if (o.goal) {
        o.theta += (o.goal.theta - o.theta) * 0.12; o.phi += (o.goal.phi - o.phi) * 0.12;
        if (Math.abs(o.goal.theta - o.theta) + Math.abs(o.goal.phi - o.phi) < 0.002) o.goal = null;
      }
      const sp = Math.sin(o.phi), cp = Math.cos(o.phi);
      camera.position.set(o.t.x + o.r * sp * Math.cos(o.theta), o.t.y + o.r * cp, o.t.z + o.r * sp * Math.sin(o.theta));
      camera.lookAt(o.t);
    },
  };
}

/** 그룹의 경계 상자에서 카메라 목표와 거리 계산 */
export function frameOf(group, pad = 1.15) {
  const bb = new THREE.Box3().setFromObject(group);
  if (bb.isEmpty()) return { t: new THREE.Vector3(), r: 400 };
  const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  return { t: c, r: Math.max(120, s.length() * pad) };
}
