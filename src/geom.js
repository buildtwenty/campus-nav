// 2D 폴리곤 유틸. three.js 의존 없음 (편집기·검사 스크립트 공용)

export function centroid(poly) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
    const f = x0 * z1 - x1 * z0;
    a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-9) { // 퇴화 폴리곤이면 평균
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cz / (6 * a)];
}

export function area(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n];
    a += x0 * z1 - x1 * z0;
  }
  return Math.abs(a) / 2;
}

export function bbox(polys) {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const poly of polys) for (const [x, z] of poly) {
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (z < b.minZ) b.minZ = z;
    if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}

export function pointInPoly([px, pz], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
export const roundPoly = (poly, d = 2) => poly.map(([x, z]) => [round(x, d), round(z, d)]);
