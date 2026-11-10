(function () {
  'use strict';
  const {
    DIFFICULTIES,
    CHARACTERS,
    TIMING,
    WARNING_SEC,
    createDeck,
    createMemoryGame,
    createTimer,
    remainingSec,
    buildResult,
    createSymbol,
  } = window.MPG;

  // 게임 화면 컨트롤러: 미리보기 → 덮기 → 플레이 → 종료 흐름과 DOM, 효과음을 담당한다.
  // 판정·타이머·점수 로직은 game.js에 있다.

  function createPlay({ sound, onFinish, onExit }) {
    const $ = (id) => document.getElementById(id);
    const screen = document.querySelector('.screen-game');
    const board = $('game-board');
    const elapsedEl = $('game-elapsed');
    const goalEl = $('game-goal');
    const msgText = $('game-message-text');
    const countEl = $('game-count');
    const pauseBtn = $('btn-pause');
    const exitBtn = $('btn-exit');
    const pausePanel = $('pause-panel');
    const confirmBox = $('game-confirm');
    const stayBtn = $('btn-confirm-stay');
    const leaveBtn = $('btn-confirm-leave');

    // 한 판의 상태. 없으면 null.
    // phase: preview → covering → playing → done
    // reasons: 시간을 멈추는 이유 ('pause' 일시정지, 'confirm' 나가기 확인 창)
    let s = null;

    // ── 패 DOM ──────────────────────────────────
    function buildBoard() {
      board.replaceChildren();
      s.cards.forEach((card) => {
        const li = document.createElement('li');
        li.className = 'board-item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'card is-open'; // 미리보기: 처음부터 앞면
        btn.dataset.index = card.index;

        const inner = document.createElement('span');
        inner.className = 'card-inner';

        const back = document.createElement('span');
        back.className = 'face face-back';
        back.setAttribute('aria-hidden', 'true');
        back.textContent = '?';

        const front = document.createElement('span');
        front.className = 'face face-front';
        front.appendChild(createSymbol(card.item));

        inner.append(back, front);
        btn.appendChild(inner);
        li.appendChild(btn);
        board.appendChild(li);
        setLabel(btn, card.item.name, true);
      });
    }

    function setLabel(btn, name, open, matched = false) {
      btn.setAttribute('aria-label', open ? (matched ? `${name}, 맞춤` : name) : '덮인 패');
    }

    function cardEl(i) {
      return board.children[i].firstElementChild;
    }

    function setOpen(i, open) {
      const btn = cardEl(i);
      btn.classList.toggle('is-open', open);
      setLabel(btn, s.cards[i].item.name, open);
    }

    function setMatched(i) {
      const btn = cardEl(i);
      btn.classList.add('is-matched');
      setLabel(btn, s.cards[i].item.name, true, true);
    }

    // ── 메시지·시간 표시 ────────────────────────
    function setMessage(text, count = '') {
      msgText.textContent = text;
      countEl.textContent = count;
    }

    function showElapsed(ms) {
      const sec = Math.floor(ms / 1000);
      if (sec !== s.shownSec) {
        s.shownSec = sec;
        elapsedEl.textContent = `${sec}초`;
      }
    }

    // 목표 시간 임박·초과: 시간 숫자를 주황색으로 바꾸고, 알림음을 한 번 낸다.
    // 색만으로 알리지 않도록 안내 문구도 함께 바꾼다.
    function checkGoal(ms) {
      const remain = s.settings.goalSec - ms / 1000;
      if (!s.warned && remain <= WARNING_SEC) {
        s.warned = true;
        elapsedEl.classList.add('is-warning');
        setMessage('곧 목표 시간이에요');
        sound.play('warn');
      }
      if (!s.overGoal && remain <= 0) {
        s.overGoal = true;
        setMessage('목표 시간이 지났어요. 계속해요');
      }
    }

    // ── 시간 흐름 ───────────────────────────────
    // 실행 중이어야 하는 타이머만 돌리고 나머지는 멈춘다.
    function syncTimers() {
      const suspended = s.reasons.size > 0;
      const run = (timer, should) => (should && !suspended ? timer.start() : timer.pause());
      run(s.previewTimer, s.phase === 'preview');
      run(s.playTimer, s.phase === 'playing');
    }

    // 화면 갱신 루프. 시간은 timer가 시작 시각 기준으로 계산하므로 여기서 누적하지 않는다.
    function loop() {
      const cur = s;
      if (!cur) return;
      if (cur.phase === 'preview') {
        const rem = remainingSec(cur.d.previewSec, cur.previewTimer.elapsedMs());
        if (rem !== cur.shownCount) {
          cur.shownCount = rem;
          countEl.textContent = rem;
          if (rem > 0) sound.play('tick');
        }
        if (rem <= 0) beginCover();
      } else if (cur.phase === 'playing') {
        const ms = cur.playTimer.elapsedMs();
        showElapsed(ms);
        checkGoal(ms);
      }
      if (s === cur) cur.raf = requestAnimationFrame(loop);
    }

    function beginCover() {
      s.phase = 'covering';
      s.previewTimer.stop();
      setMessage('패를 덮어요');
      sound.play('cover');
      s.cards.forEach((_, i) => setOpen(i, false));
      const cur = s;
      s.coverTimer = setTimeout(() => {
        if (s !== cur) return;
        s.phase = 'playing'; // 덮인 뒤에 진행 시간 시작
        setMessage('같은 그림을 찾아요');
        pauseBtn.disabled = false;
        syncTimers();
      }, TIMING.coverMs);
    }

    // ── 패 탭 ───────────────────────────────────
    function closeMismatch() {
      clearTimeout(s.mismatchTimer);
      s.game.closeMismatch().forEach((i) => setOpen(i, false));
    }

    function onBoardClick(e) {
      const btn = e.target.closest('.card');
      if (!btn || !s || s.phase !== 'playing' || s.reasons.size > 0) return;

      const index = Number(btn.dataset.index);
      const res = s.game.flip(index);
      if (res.type === 'ignored') return;

      // 반응 속도: 클래스를 바꾸는 즉시 애니메이션이 시작된다. 소리는 그 직후.
      setOpen(index, true);
      sound.play('flip');

      if (res.type === 'match') {
        res.indices.forEach(setMatched);
        sound.play('match', 0.3);
        if (res.done) finish();
      } else if (res.type === 'mismatch') {
        sound.play('mismatch', 0.35);
        const cur = s;
        s.mismatchTimer = setTimeout(() => {
          if (s === cur) closeMismatch();
        }, TIMING.mismatchShowMs);
      }
    }

    function finish() {
      s.phase = 'done';
      const ms = s.playTimer.stop();
      showElapsed(ms);
      setMessage('모두 찾았어요!');
      pauseBtn.disabled = true;
      exitBtn.disabled = true;

      const result = buildResult(s.settings, ms); // 결과 데이터는 game.js 한 곳에서만 만든다
      sound.play(result.goalMet ? 'clear' : 'clearSlow', 0.7);

      const cur = s;
      s.finishTimer = setTimeout(() => {
        if (s !== cur) return;
        stopSession();
        onFinish(result);
      }, TIMING.finishDelayMs);
    }

    // ── 일시정지·나가기 ─────────────────────────
    function addReason(reason) {
      s.reasons.add(reason);
      closeMismatch(); // 멈추는 동안 열려 있던 불일치 패는 바로 덮는다
      syncTimers();
      renderSuspend();
    }

    function removeReason(reason) {
      s.reasons.delete(reason);
      syncTimers();
      renderSuspend();
    }

    function renderSuspend() {
      const paused = s.reasons.has('pause');
      screen.classList.toggle('is-paused', paused); // 패를 가린다
      pausePanel.hidden = !paused;
      pauseBtn.textContent = paused ? '계속하기' : '일시정지';
    }

    pauseBtn.addEventListener('click', () => {
      if (!s || s.phase !== 'playing' || s.reasons.has('confirm')) return;
      if (s.reasons.has('pause')) removeReason('pause');
      else addReason('pause');
    });

    exitBtn.addEventListener('click', () => {
      if (!s || s.phase === 'done') return;
      addReason('confirm');
      confirmBox.hidden = false;
      stayBtn.focus();
    });

    stayBtn.addEventListener('click', () => {
      if (!s) return;
      confirmBox.hidden = true;
      removeReason('confirm');
      exitBtn.focus();
    });

    leaveBtn.addEventListener('click', () => {
      stopSession();
      onExit();
    });

    board.addEventListener('click', onBoardClick);

    // ── 시작·정리 ───────────────────────────────
    function stopSession() {
      if (s) {
        cancelAnimationFrame(s.raf);
        clearTimeout(s.coverTimer);
        clearTimeout(s.mismatchTimer);
        clearTimeout(s.finishTimer);
      }
      s = null;
      confirmBox.hidden = true;
      pausePanel.hidden = true;
      screen.classList.remove('is-paused');
    }

    function start(settings) {
      stopSession();
      const d = DIFFICULTIES[settings.difficulty];
      const cards = createDeck(CHARACTERS[settings.character].items, d.pairs);

      s = {
        settings,
        d,
        cards,
        game: createMemoryGame(cards),
        phase: 'preview',
        reasons: new Set(),
        previewTimer: createTimer(),
        playTimer: createTimer(),
        shownSec: -1,
        shownCount: -1,
        warned: false,
        overGoal: false,
        raf: 0,
      };

      screen.style.setProperty('--cols', d.cols);
      screen.style.setProperty('--rows', d.rows);
      buildBoard();

      goalEl.textContent = `${settings.goalSec}초`;
      elapsedEl.textContent = '0초';
      elapsedEl.classList.remove('is-warning');
      pauseBtn.disabled = true; // 미리보기 중에는 일시정지 불가
      exitBtn.disabled = false;
      pauseBtn.textContent = '일시정지';
      setMessage('그림을 외워요', d.previewSec);

      syncTimers();
      loop();
    }

    return { start, stop: stopSession };
  }

  Object.assign(window.MPG, { createPlay });
})();
