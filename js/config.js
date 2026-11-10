(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPG = Object.assign(root.MPG || {}, factory());
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

// 게임 설정값. PRD 5장 난이도 표(초안)를 그대로 옮긴 것이며, 플레이 테스트 후 이 파일만 고치면 됩니다.

// 난이도별 설정
// cols × rows = 가로 × 세로 배치, cards = 전체 패 수, pairs = 쌍 수
const DIFFICULTIES = {
  low: {
    id: 'low',
    label: '하',
    pairs: 6,
    cards: 12,
    cols: 4,
    rows: 3,
    previewSec: 5, // 미리보기 시간(초)
    goalDefaultSec: 60, // 목표 시간 기본값(초)
    baseSec: 40, // 점수 계산용 기준 시간(초)
    multiplier: 1.0, // 점수 배수
  },
  mid: {
    id: 'mid',
    label: '중',
    pairs: 8,
    cards: 16,
    cols: 4,
    rows: 4,
    previewSec: 8,
    goalDefaultSec: 100,
    baseSec: 70,
    multiplier: 1.5,
  },
  high: {
    id: 'high',
    label: '상',
    pairs: 10,
    cards: 20,
    cols: 5,
    rows: 4,
    previewSec: 12,
    goalDefaultSec: 180,
    baseSec: 120,
    multiplier: 2.0,
  },
};

const DIFFICULTY_ORDER = ['low', 'mid', 'high'];

// 점수 계산 (PRD 5장 초안)
//   시간점수 = min(timeCap, timeBase × 기준시간 ÷ 걸린시간)
//   최종점수 = 시간점수 × 난이도 배수 + (목표 시간 이내면 goalBonus)
const SCORE = { timeCap: 1500, timeBase: 1000, goalBonus: 500 };

// 시간 관련 설정
const WARNING_SEC = 10; // 목표 시간 몇 초 전부터 경고(주황색 + 알림음)할지
const TIMING = {
  mismatchShowMs: 1000, // 불일치 시 두 장을 보여 주는 시간 (PRD 8장: 조정 대상)
  coverMs: 600, // 미리보기가 끝나고 패가 덮이는 동안 기다리는 시간
  finishDelayMs: 900, // 마지막 짝을 본 뒤 결과 화면으로 넘어가기까지
};

// 목표 시간 슬라이더 (초)
const GOAL_SLIDER = { min: 20, max: 300, step: 5 };

// 설정 화면은 매번 이 값에서 시작합니다 (PRD 3장).
const DEFAULT_SELECTION = { difficulty: 'mid', character: 'fruit' };

// ── 캐릭터 ─────────────────────────────────────────
// 항목: { id, name, emoji } 또는 { id, name, svg }
// 가장 많이 쓰는 '상' 난이도가 10쌍이라 각 세트에 10종 이상 둡니다.

const fruit = [
  ['apple', '사과', '🍎'],
  ['banana', '바나나', '🍌'],
  ['grape', '포도', '🍇'],
  ['orange', '귤', '🍊'],
  ['strawberry', '딸기', '🍓'],
  ['watermelon', '수박', '🍉'],
  ['peach', '복숭아', '🍑'],
  ['cherry', '체리', '🍒'],
  ['kiwi', '키위', '🥝'],
  ['lemon', '레몬', '🍋'],
  ['pear', '배', '🍐'],
  ['pineapple', '파인애플', '🍍'],
].map(([id, name, emoji]) => ({ id, name, emoji }));

const animal = [
  ['dog', '강아지', '🐶'],
  ['cat', '고양이', '🐱'],
  ['rabbit', '토끼', '🐰'],
  ['bear', '곰', '🐻'],
  ['panda', '판다', '🐼'],
  ['fox', '여우', '🦊'],
  ['frog', '개구리', '🐸'],
  ['monkey', '원숭이', '🐵'],
  ['tiger', '호랑이', '🐯'],
  ['cow', '소', '🐮'],
  ['pig', '돼지', '🐷'],
  ['chick', '병아리', '🐥'],
].map(([id, name, emoji]) => ({ id, name, emoji }));

const flower = [
  ['cherry-blossom', '벚꽃', '🌸'],
  ['rose', '장미', '🌹'],
  ['sunflower', '해바라기', '🌻'],
  ['tulip', '튤립', '🌷'],
  ['daisy', '노란 꽃', '🌼'],
  ['hibiscus', '무궁화', '🌺'],
  ['bouquet', '꽃다발', '💐'],
  ['rosette', '장식 꽃', '🏵️'],
  ['wilted', '시든 꽃', '🥀'],
  ['white-flower', '흰 꽃', '💮'],
].map(([id, name, emoji]) => ({ id, name, emoji }));

// 컬러도형: 색과 모양을 모두 다르게 해서, 색을 구분하기 어려워도 모양으로 찾을 수 있습니다.
// 이름(예: '빨간 동그라미')도 함께 표시할 수 있도록 name에 색과 모양을 모두 담았습니다.
const SHAPE_PATHS = {
  circle: '<circle cx="50" cy="50" r="42"/>',
  square: '<rect x="10" y="10" width="80" height="80" rx="6"/>',
  triangle: '<polygon points="50,8 94,88 6,88"/>',
  star: '<polygon points="50,6 61,38 95,38 67,58 78,92 50,71 22,92 33,58 5,38 39,38"/>',
  diamond: '<polygon points="50,6 94,50 50,94 6,50"/>',
  heart: '<path d="M50 88 C10 58 6 30 26 18 C40 10 50 22 50 30 C50 22 60 10 74 18 C94 30 90 58 50 88 Z"/>',
  pentagon: '<polygon points="50,6 94,38 77,90 23,90 6,38"/>',
  hexagon: '<polygon points="28,10 72,10 96,50 72,90 28,90 4,50"/>',
  cross: '<polygon points="35,6 65,6 65,35 94,35 94,65 65,65 65,94 35,94 35,65 6,65 6,35 35,35"/>',
  halfcircle: '<path d="M6 72 A44 44 0 0 1 94 72 Z"/>',
};

function shapeSvg(shape, color) {
  return (
    '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    `<g fill="${color}" stroke="#1A1A1A" stroke-width="4" stroke-linejoin="round">${SHAPE_PATHS[shape]}</g>` +
    '</svg>'
  );
}

const colorShape = [
  ['red-circle', '빨간 동그라미', 'circle', '#C62828'],
  ['blue-square', '파란 네모', 'square', '#1565C0'],
  ['yellow-triangle', '노란 세모', 'triangle', '#F9A825'],
  ['green-star', '초록 별', 'star', '#2E7D32'],
  ['purple-diamond', '보라 마름모', 'diamond', '#6A1B9A'],
  ['orange-heart', '주황 하트', 'heart', '#EF6C00'],
  ['pink-pentagon', '분홍 오각형', 'pentagon', '#EC407A'],
  ['sky-hexagon', '하늘 육각형', 'hexagon', '#29B6F6'],
  ['brown-cross', '갈색 십자', 'cross', '#6D4C41'],
  ['black-halfcircle', '검정 반원', 'halfcircle', '#212121'],
].map(([id, name, shape, color]) => ({ id, name, svg: shapeSvg(shape, color) }));

const CHARACTERS = {
  fruit: { id: 'fruit', label: '과일', items: fruit },
  animal: { id: 'animal', label: '동물', items: animal },
  flower: { id: 'flower', label: '꽃', items: flower },
  shape: { id: 'shape', label: '컬러도형', items: colorShape },
};

const CHARACTER_ORDER = ['fruit', 'animal', 'flower', 'shape'];

  return { SCORE, WARNING_SEC, TIMING, DIFFICULTIES, DIFFICULTY_ORDER, GOAL_SLIDER, DEFAULT_SELECTION, CHARACTERS, CHARACTER_ORDER };
});
