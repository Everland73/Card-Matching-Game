import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shuffle, createDeck, createMemoryGame, createTimer, remainingSec, calcScore, buildResult } = require('../js/game.js');
const { CHARACTERS, DIFFICULTIES, GOAL_SLIDER } = require('../js/config.js');

test('goal slider: 목표 시간은 최대 180초', () => {
  assert.equal(GOAL_SLIDER.max, 180);
});

// 항상 같은 순서가 나오는 간단한 난수
function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

// 직접 만든 패 배열: [A, B, A, B]
function makeGame(ids = ['a', 'b', 'a', 'b']) {
  const cards = ids.map((id, index) => ({ index, pairId: id, item: { id } }));
  return createMemoryGame(cards);
}

// ── 덱 ─────────────────────────────────────────
test('shuffle: 원소는 그대로이고 원본은 바뀌지 않는다', () => {
  const src = [1, 2, 3, 4, 5, 6];
  const out = shuffle(src, seeded(3));
  assert.deepEqual([...out].sort(), src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
});

test('createDeck: 모든 난이도·캐릭터에서 같은 그림이 정확히 2장씩', () => {
  for (const d of Object.values(DIFFICULTIES)) {
    for (const c of Object.values(CHARACTERS)) {
      const deck = createDeck(c.items, d.pairs, seeded(7));
      assert.equal(deck.length, d.cards);
      const counts = {};
      deck.forEach((card) => (counts[card.pairId] = (counts[card.pairId] ?? 0) + 1));
      assert.equal(Object.keys(counts).length, d.pairs);
      assert.ok(Object.values(counts).every((n) => n === 2));
      assert.deepEqual(deck.map((card) => card.index), [...deck.keys()]);
    }
  }
});

test('createDeck: 그림이 부족하면 오류', () => {
  assert.throws(() => createDeck([{ id: 'x' }], 2));
});

// ── 판정 ───────────────────────────────────────
test('flip: 같은 쌍이면 match, 고정되어 다시 탭해도 무시', () => {
  const g = makeGame();
  assert.deepEqual(g.flip(0), { type: 'flipped', index: 0 });
  assert.deepEqual(g.flip(2), { type: 'match', indices: [0, 2], done: false });
  assert.equal(g.getStatus(0), 'matched');
  assert.deepEqual(g.flip(0), { type: 'ignored', reason: 'matched' });
});

test('flip: 다른 쌍이면 mismatch, 덮기 전까지 다른 패 탭은 무시', () => {
  const g = makeGame();
  g.flip(0);
  assert.deepEqual(g.flip(1), { type: 'mismatch', indices: [0, 1] });
  assert.equal(g.isLocked(), true);
  assert.deepEqual(g.flip(2), { type: 'ignored', reason: 'locked' });
  assert.deepEqual(g.flip(3), { type: 'ignored', reason: 'locked' });
});

test('closeMismatch: 두 장이 다시 덮이고 잠금이 풀린다', () => {
  const g = makeGame();
  g.flip(0);
  g.flip(1);
  assert.deepEqual(g.closeMismatch(), [0, 1]);
  assert.equal(g.getStatus(0), 'hidden');
  assert.equal(g.isLocked(), false);
  assert.equal(g.flip(0).type, 'flipped');
  assert.deepEqual(g.closeMismatch(), []); // 불일치가 없으면 아무 일도 없다
});

test('flip: 같은 패를 연속으로 탭하면 두 번째는 무시 (짝으로 오인하지 않음)', () => {
  const g = makeGame();
  g.flip(0);
  assert.deepEqual(g.flip(0), { type: 'ignored', reason: 'same' });
  assert.equal(g.isLocked(), false);
});

test('flip: 범위 밖·숫자가 아닌 값은 무시', () => {
  const g = makeGame();
  for (const bad of [-1, 4, 1.5, NaN, undefined]) {
    assert.deepEqual(g.flip(bad), { type: 'ignored', reason: 'invalid' });
  }
});

test('모든 쌍을 맞추면 마지막 match에서 done=true', () => {
  const g = makeGame();
  g.flip(0);
  g.flip(2);
  g.flip(1);
  const last = g.flip(3);
  assert.deepEqual(last, { type: 'match', indices: [1, 3], done: true });
  assert.equal(g.isDone(), true);
});

test('틀린 뒤에도 끝까지 진행해서 완료할 수 있다', () => {
  const g = makeGame();
  g.flip(0);
  g.flip(1);
  g.closeMismatch();
  g.flip(1);
  g.flip(3);
  g.flip(0);
  assert.equal(g.flip(2).done, true);
});

// ── 타이머 ─────────────────────────────────────
test('timer: 시작 시각 기준으로 경과 시간을 계산', () => {
  let t = 1000;
  const timer = createTimer(() => t);
  assert.equal(timer.elapsedMs(), 0);
  timer.start();
  t += 2500;
  assert.equal(timer.elapsedMs(), 2500);
  t += 60000; // 틱이 없어도(탭이 백그라운드여도) 시계 기준으로 맞는다
  assert.equal(timer.elapsedMs(), 62500);
});

test('timer: 일시정지 중에는 시간이 흐르지 않고, 재개하면 이어서 간다', () => {
  let t = 0;
  const timer = createTimer(() => t);
  timer.start();
  t += 3000;
  timer.pause();
  t += 10000;
  assert.equal(timer.elapsedMs(), 3000);
  timer.start();
  t += 1000;
  assert.equal(timer.elapsedMs(), 4000);
});

test('timer: start·pause를 중복 호출해도 값이 어긋나지 않는다', () => {
  let t = 0;
  const timer = createTimer(() => t);
  timer.start();
  t += 1000;
  timer.start(); // 이미 실행 중이면 무시
  t += 1000;
  timer.pause();
  timer.pause();
  assert.equal(timer.elapsedMs(), 2000);
});

test('timer: stop은 멈추고 경과 시간을 돌려준다', () => {
  let t = 0;
  const timer = createTimer(() => t);
  timer.start();
  t += 4200;
  assert.equal(timer.stop(), 4200);
  t += 5000;
  assert.equal(timer.elapsedMs(), 4200);
  assert.equal(timer.isRunning(), false);
});

test('remainingSec: 올림으로 계산하고 0 아래로 내려가지 않는다', () => {
  assert.equal(remainingSec(5, 0), 5);
  assert.equal(remainingSec(5, 100), 5);
  assert.equal(remainingSec(5, 1000), 4);
  assert.equal(remainingSec(5, 4999), 1);
  assert.equal(remainingSec(5, 5000), 0);
  assert.equal(remainingSec(5, 9000), 0);
});

// ── 점수 계산 (PRD 5장) ────────────────────────
const score = (elapsedSec, goalSec, difficulty = 'mid') => calcScore({ elapsedSec, goalSec }, difficulty);

test('calcScore: PRD 예시 - 중, 100초에 끝, 목표 100초 → 1,550점', () => {
  const r = score(100, 100, 'mid');
  assert.equal(r.timeScore, 700);
  assert.equal(r.multiplier, 1.5);
  assert.equal(r.bonus, 500);
  assert.equal(r.total, 1550);
});

test('calcScore: 기준 시간에 끝내면 시간점수 1000 (난이도별)', () => {
  assert.equal(score(40, 999, 'low').timeScore, 1000);
  assert.equal(score(70, 999, 'mid').timeScore, 1000);
  assert.equal(score(120, 999, 'high').timeScore, 1000);
});

test('calcScore: 난이도 배수 ×1.0 / ×1.5 / ×2.0', () => {
  assert.equal(score(40, 40, 'low').total, 1000 * 1.0 + 500);
  assert.equal(score(70, 70, 'mid').total, 1000 * 1.5 + 500);
  assert.equal(score(120, 120, 'high').total, 1000 * 2.0 + 500);
});

test('calcScore: 시간점수 상한 1500 경계 (기준 70초 → 약 46.67초가 경계)', () => {
  assert.equal(score(46.7, 100, 'mid').timeScore, 1499); // 1000×70/46.7 = 1499.1
  assert.equal(score(46.6, 100, 'mid').timeScore, 1500); // 1502.1 → 상한 적용
  assert.equal(score(10, 100, 'mid').timeScore, 1500);
  assert.equal(score(0.1, 100, 'mid').timeScore, 1500);
});

test('calcScore: 걸린 시간이 0이어도 0으로 나누지 않고 상한 점수', () => {
  const r = score(0, 100, 'mid');
  assert.equal(r.timeScore, 1500);
  assert.equal(r.total, 1500 * 1.5 + 500);
});

test('calcScore: 아주 오래 걸려도 점수는 0 이상이고 줄어든다', () => {
  assert.ok(score(1000, 100, 'mid').total >= 0);
  assert.ok(score(200, 999, 'mid').timeScore < score(100, 999, 'mid').timeScore);
});

test('calcScore: 목표 시간 경계 - 같으면 달성(보너스), 0.1초라도 넘으면 보너스 없음', () => {
  assert.equal(score(100, 100).goalMet, true);
  assert.equal(score(100, 100).bonus, 500);
  assert.equal(score(100.1, 100).goalMet, false);
  assert.equal(score(100.1, 100).bonus, 0);
  assert.equal(score(99.9, 100).goalMet, true);
});

test('calcScore: 목표 시간(슬라이더)은 보너스에만 영향, 시간점수는 그대로', () => {
  const tight = score(90, 60); // 목표를 빡빡하게 → 보너스 없음
  const loose = score(90, 300); // 목표를 느슨하게 → 보너스 있음
  assert.equal(tight.timeScore, loose.timeScore);
  assert.equal(loose.total - tight.total, 500);
});

test('calcScore: 알 수 없는 난이도는 오류', () => {
  assert.throws(() => score(10, 10, 'nope'));
});

// ── 결과 데이터 ────────────────────────────────
test('buildResult: 결과 객체 형태와 점수 (PRD 예시)', () => {
  const r = buildResult(
    { difficulty: 'mid', character: 'fruit', goalSec: 100 },
    100000,
    new Date('2026-11-10T12:00:00Z'),
  );
  assert.deepEqual(r, {
    difficulty: 'mid',
    character: 'fruit',
    elapsedSec: 100,
    goalSec: 100,
    score: 1550,
    goalMet: true,
    scoreDetail: { timeScore: 700, multiplier: 1.5, bonus: 500 },
    playedAt: '2026-11-10T12:00:00.000Z',
  });
});

test('buildResult: 걸린 시간은 0.1초로 반올림하고, 화면에 보이는 값으로 달성을 판정', () => {
  const base = { difficulty: 'mid', character: 'fruit', goalSec: 100 };
  assert.equal(buildResult(base, 100040).goalMet, true); // 100.04초 → 100.0초 표시 → 달성
  assert.equal(buildResult(base, 100060).goalMet, false); // 100.06초 → 100.1초 표시 → 초과
  assert.equal(buildResult(base, 83456).elapsedSec, 83.5);
});
