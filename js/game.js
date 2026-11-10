(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.MPG = Object.assign(root.MPG || {}, factory(root.MPG));
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cfg) {

// 게임 로직 (DOM과 무관). 화면 코드는 js/play.js에서 이 모듈을 불러 쓴다.

// Fisher-Yates. rng는 테스트에서 고정 값을 넣기 위해 주입한다.
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 캐릭터 항목에서 pairs종을 골라 2장씩 만들고 섞는다.
// 반환: [{ index, pairId, item }]  (index = 격자 안 위치)
function createDeck(items, pairs, rng = Math.random) {
  if (items.length < pairs) {
    throw new Error(`그림이 부족합니다: ${items.length}종 < ${pairs}쌍`);
  }
  const picked = shuffle(items, rng).slice(0, pairs);
  return shuffle(picked.flatMap((item) => [item, item]), rng).map((item, index) => ({
    index,
    pairId: item.id,
    item,
  }));
}

// 패 뒤집기·판정 상태 기계.
// flip() 결과:
//   { type: 'ignored', reason }          무시됨 (invalid | locked | same | matched)
//   { type: 'flipped', index }           첫 번째 장
//   { type: 'match', indices, done }     두 장 일치 (done = 모든 패 클리어)
//   { type: 'mismatch', indices }        두 장 불일치 → closeMismatch() 전까지 다른 패 무시
function createMemoryGame(cards) {
  const status = cards.map(() => 'hidden'); // hidden | open | matched
  let open = [];
  let pending = null; // 불일치로 열려 있는 두 장
  let matchedCount = 0;

  const ignored = (reason) => ({ type: 'ignored', reason });

  function flip(index) {
    if (!Number.isInteger(index) || index < 0 || index >= cards.length) return ignored('invalid');
    if (pending) return ignored('locked'); // 두 장이 열려 있는 동안 다른 패 탭은 무시
    if (status[index] === 'open') return ignored('same'); // 같은 패 연속 탭 무시
    if (status[index] === 'matched') return ignored('matched');

    status[index] = 'open';
    open.push(index);
    if (open.length === 1) return { type: 'flipped', index };

    const [a, b] = open;
    open = [];
    if (cards[a].pairId === cards[b].pairId) {
      status[a] = status[b] = 'matched';
      matchedCount += 2;
      return { type: 'match', indices: [a, b], done: matchedCount === cards.length };
    }
    pending = [a, b];
    return { type: 'mismatch', indices: [a, b] };
  }

  // 불일치 패를 다시 덮는다. 덮인 패 위치 배열을 돌려준다.
  function closeMismatch() {
    if (!pending) return [];
    const closed = pending;
    closed.forEach((i) => (status[i] = 'hidden'));
    pending = null;
    return closed;
  }

  return {
    flip,
    closeMismatch,
    getStatus: (i) => status[i],
    isLocked: () => pending !== null,
    isDone: () => matchedCount === cards.length,
    matchedCount: () => matchedCount,
  };
}

// 일시정지가 되는 타이머. 시작 시각 기준으로 계산하므로 setInterval 누적 오차가 없다.
function createTimer(now = () => performance.now()) {
  let startedAt = 0;
  let accumulated = 0;
  let running = false;

  return {
    start() {
      if (running) return;
      startedAt = now();
      running = true;
    },
    pause() {
      if (!running) return;
      accumulated += now() - startedAt;
      running = false;
    },
    // 멈추고 경과 시간(ms)을 돌려준다.
    stop() {
      this.pause();
      return accumulated;
    },
    elapsedMs: () => accumulated + (running ? now() - startedAt : 0),
    isRunning: () => running,
  };
}

// 카운트다운에 보여 줄 남은 초 (올림: 5.2초 남음 → 6)
function remainingSec(totalSec, elapsedMs) {
  return Math.max(0, Math.ceil(totalSec - elapsedMs / 1000));
}

// 점수 계산 (PRD 5장).
// - 시간점수는 난이도별 고정 기준시간으로만 계산한다. 목표 시간(슬라이더)은 보너스 여부에만 쓴다.
// - elapsedSec는 화면에 보이는 값(0.1초 단위)을 그대로 쓴다. 목표 시간과 같으면 달성으로 본다.
function calcScore({ elapsedSec, goalSec }, difficultyId) {
  const diff = cfg.DIFFICULTIES[difficultyId];
  if (!diff) throw new Error(`알 수 없는 난이도: ${difficultyId}`);
  const { timeCap, timeBase, goalBonus } = cfg.SCORE;

  const raw = elapsedSec > 0 ? (timeBase * diff.baseSec) / elapsedSec : timeCap;
  const timeScore = Math.min(timeCap, raw);
  const goalMet = elapsedSec <= goalSec;
  const bonus = goalMet ? goalBonus : 0;

  return {
    timeScore: Math.round(timeScore),
    multiplier: diff.multiplier,
    bonus,
    goalMet,
    total: Math.round(timeScore * diff.multiplier + bonus),
  };
}

// 결과 데이터를 만드는 유일한 곳.
// [2단계 확장 지점] 기록 저장·순위는 이 객체를 그대로 저장하면 된다 (js/main.js의 onFinish 참고).
// 필드: difficulty, character, elapsedSec, goalSec, score, playedAt (+ 화면용 goalMet, scoreDetail)
function buildResult({ difficulty, character, goalSec }, elapsedMs, playedAt = new Date()) {
  const elapsedSec = Math.round(elapsedMs / 100) / 10; // 0.1초 단위
  const s = calcScore({ elapsedSec, goalSec }, difficulty);
  return {
    difficulty,
    character,
    elapsedSec,
    goalSec,
    score: s.total,
    goalMet: s.goalMet,
    scoreDetail: { timeScore: s.timeScore, multiplier: s.multiplier, bonus: s.bonus },
    playedAt: playedAt.toISOString(),
  };
}

  return { shuffle, createDeck, createMemoryGame, createTimer, remainingSec, calcScore, buildResult };
});
