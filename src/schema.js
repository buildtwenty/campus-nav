// 공통 상수. 데이터 뜻은 docs/data-model.md 참고.

// 연결 종류별 비용 가중치 (거리 × 가중치 + 고정값, 단위 m)
export const COST = {
  walk: { w: 1.0, fixed: 0 },
  esc: { w: 1.1, fixed: 0 },
  elevator: { w: 1.3, fixed: 20 },  // 대기 시간을 거리로 환산
  mix: { w: 1.4, fixed: 0 },       // 계단인지 에스컬레이터인지 미확인
  stair: { w: 1.6, fixed: 0 },
  gate: { w: 1.0, fixed: 6 },      // 출입통제문
};

// 층을 넘을 수 있는 연결 종류
export const VERTICAL = new Set(['stair', 'esc', 'elevator', 'mix']);

export const EDGE_TYPES = ['walk', 'stair', 'elevator', 'esc', 'gate', 'mix'];

export const NODE_TYPES = {
  entrance: { ko: '출입구', color: '#2e9e5b' },
  corridor: { ko: '복도', color: '#8a8f98' },
  stair_landing: { ko: '계단', color: '#d9822b' },
  elevator: { ko: '엘리베이터', color: '#7b5ad6' },
  gate: { ko: '출입통제문', color: '#c0392b' },
};

export const ROOM_TYPES = {
  lecture: { ko: '강의실', color: '#4f8ef7' },
  lab: { ko: '실험실·연구실', color: '#36b37e' },
  office: { ko: '사무실·행정실', color: '#f5a623' },
  toilet: { ko: '화장실', color: '#00b8d9' },
  stair: { ko: '계단실', color: '#d9822b' },
  elevator: { ko: '엘리베이터', color: '#7b5ad6' },
  lounge: { ko: '휴게·라운지', color: '#ff7eb6' },
  store: { ko: '매점·편의', color: '#ffab00' },
  other: { ko: '기타', color: '#9aa5b1' },
};

export const HOW_KO = {
  esc: '에스컬레이터로',
  stair: '계단으로',
  mix: '계단 또는 에스컬레이터로',
  elevator: '엘리베이터로',
};

export const DEFAULT_FLOOR_HEIGHT = 4.2;
export const DEFAULT_Y_SCALE = 1.5;

/** 새 건물 JSON 기본값 */
export function emptyVenue(id = 'new-building', name = '새 건물') {
  return {
    id, kind: 'building', name, campus: '', aliases: [],
    location: null,
    source: { urls: [], checked: '', note: '' },
    units: 'm', yScale: DEFAULT_Y_SCALE,
    floors: [], rooms: [], nodes: {}, edges: [],
    facts: { ok: [], est: [] },
  };
}
