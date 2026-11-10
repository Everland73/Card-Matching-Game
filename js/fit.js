// 화면 맞춤: 시작·설정·결과 화면의 내용이 기기 화면보다 크면, 잘리거나 스크롤되지 않도록
// 내용을 비율에 맞춰 줄인다. (CSS가 먼저 간격·크기를 줄이고, 그래도 넘칠 때만 이 코드가 줄인다)
// 게임 화면은 패 격자를 CSS만으로 남은 공간에 맞춘다. 가로 배치일 때의 왼쪽 칸만 여기서 줄인다.
(function () {
  'use strict';

  const MIN_SCALE = 0.55; // 이보다 더 줄이면 글씨가 너무 작아지므로, 그때는 스크롤을 허용한다
  const SIDE_MIN_SCALE = 0.5;

  // 모바일 브라우저는 주소창 때문에 100vh가 실제 보이는 높이와 다르다. 실제 높이를 변수로 둔다.
  function setAppHeight() {
    document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
  }

  // 배율 k로 줄이면 가로를 W/k로 넓혀서 배치한다(줄어든 화면에 꼭 맞게).
  // 그 상태에서 높이가 H 안에 들어가는지, 가로로 넘치지 않는지 본다.
  function measure(inner, W, H, k) {
    inner.style.transform = 'none';
    inner.style.width = `${W / k}px`;
    inner.style.minHeight = '0px';
    const h = inner.offsetHeight;
    const w = inner.scrollWidth;
    return { h, ok: h * k <= H + 0.5 && w <= W / k + 0.5 };
  }

  // 들어가는 가장 큰 배율을 이진 탐색으로 찾는다.
  function findScale(inner, W, H, min) {
    if (measure(inner, W, H, 1).ok) return 1;
    let lo = min;
    let hi = 1;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (measure(inner, W, H, mid).ok) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  function fitOne(screen) {
    if (screen.hidden) return;
    const inner = screen.querySelector(':scope > .fit');
    const W = screen.clientWidth;
    const H = screen.clientHeight;
    if (!inner || !W || !H) return;

    const k = findScale(inner, W, H, MIN_SCALE);
    const { h } = measure(inner, W, H, k);
    inner.style.width = `${W / k}px`;
    inner.style.minHeight = `${H / k}px`; // 화면을 꽉 채워서 가운데 정렬이 유지되게
    inner.style.transform = k < 1 ? `scale(${k})` : 'none';
    screen.style.overflowY = h * k > H + 1 ? 'auto' : 'hidden'; // 최소 배율로도 넘칠 때만 스크롤
    screen.dataset.scale = k.toFixed(2);
  }

  // 게임 화면이 가로 배치(시간·버튼이 왼쪽 칸)일 때, 그 칸이 화면 높이보다 크면 칸만 줄인다.
  // (세로 배치에서는 패 격자가 남은 공간을 쓰므로 줄일 필요가 없다)
  function fitGameSide() {
    const screen = document.querySelector('.screen-game');
    if (!screen || screen.hidden) return;
    const side = screen.querySelector('.game-side');
    side.style.transform = 'none';
    side.style.width = '';
    side.style.justifyContent = '';
    if (getComputedStyle(screen).flexDirection !== 'row') return;

    const cs = getComputedStyle(screen);
    const H = screen.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const baseW = side.getBoundingClientRect().width;
    side.style.justifyContent = 'flex-start'; // 가운데 정렬이면 위로 넘친 부분이 scrollHeight에 안 잡힌다

    const ok = (k) => {
      side.style.width = `${baseW / k}px`;
      return side.scrollHeight * k <= H + 0.5;
    };
    let k = 1;
    if (!ok(1)) {
      let lo = SIDE_MIN_SCALE;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      k = lo;
    }

    side.style.justifyContent = '';
    if (k >= 1) {
      side.style.width = '';
      return;
    }
    side.style.width = `${baseW / k}px`;
    side.style.transformOrigin = '0 0';
    side.style.transform = `scale(${k})`;
  }

  function refresh() {
    setAppHeight();
    document.querySelectorAll('.screen:not(.screen-game)').forEach(fitOne);
    fitGameSide();
  }

  let timer = 0;
  function refreshSoon() {
    refresh();
    clearTimeout(timer);
    timer = setTimeout(refresh, 250); // 화면 회전 직후 크기가 늦게 확정되는 기기 대비
  }

  window.addEventListener('resize', refreshSoon);
  window.addEventListener('orientationchange', refreshSoon);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refreshSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  setAppHeight();

  Object.assign(window.MPG, { fit: { refresh } });
})();
