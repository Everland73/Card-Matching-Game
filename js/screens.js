(function () {
  'use strict';
  const { DIFFICULTIES, DIFFICULTY_ORDER, CHARACTERS, CHARACTER_ORDER, GOAL_SLIDER, DEFAULT_SELECTION } = window.MPG;

// 화면 전환과 화면별 구성.

const $ = (id) => document.getElementById(id);

// 패 그림(이모지 또는 SVG)을 요소로 만든다.
function createSymbol(item) {
  const el = document.createElement('span');
  el.className = 'symbol';
  el.setAttribute('aria-hidden', 'true');
  if (item.svg) el.innerHTML = item.svg; // config.js에서 직접 만든 고정 마크업
  else el.textContent = item.emoji;
  return el;
}

// ── 화면 전환 ──────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  window.scrollTo(0, 0);
  if (name !== 'result') clearConfetti();
  const heading = document.querySelector(`.screen[data-screen="${name}"] h1, .screen[data-screen="${name}"] h2`);
  if (heading) heading.focus({ preventScroll: true });
}

// ── 설정 화면 ──────────────────────────────────────
// 반환: { reset(), getSettings() }
function initSetupScreen({ onStart }) {
  const diffGroup = $('difficulty-group');
  const charGroup = $('character-group');
  const slider = $('goal-slider');
  const goalValue = $('goal-value');

  let state = { ...DEFAULT_SELECTION, goalSec: DIFFICULTIES[DEFAULT_SELECTION.difficulty].goalDefaultSec };

  slider.min = GOAL_SLIDER.min;
  slider.max = GOAL_SLIDER.max;
  slider.step = GOAL_SLIDER.step;
  $('goal-min').textContent = `${GOAL_SLIDER.min}초`;
  $('goal-max').textContent = `${GOAL_SLIDER.max}초`;

  // 선택 버튼(라디오 역할)
  function makeChoice(group, id, build) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.dataset.id = id;
    btn.setAttribute('role', 'radio');
    build(btn);
    group.appendChild(btn);
    return btn;
  }

  DIFFICULTY_ORDER.forEach((id) => {
    const d = DIFFICULTIES[id];
    makeChoice(diffGroup, id, (btn) => {
      btn.innerHTML = `<span class="choice-main"></span><span class="choice-sub"></span>`;
      btn.querySelector('.choice-main').textContent = d.label;
      btn.querySelector('.choice-sub').textContent = `${d.cards}장`;
      btn.setAttribute('aria-label', `난이도 ${d.label}, ${d.cards}장`);
    });
  });

  CHARACTER_ORDER.forEach((id) => {
    const c = CHARACTERS[id];
    makeChoice(charGroup, id, (btn) => {
      btn.classList.add('choice-char');
      btn.appendChild(createSymbol(c.items[0]));
      const label = document.createElement('span');
      label.className = 'choice-main';
      label.textContent = c.label;
      btn.appendChild(label);
    });
  });

  function renderSlider() {
    slider.value = state.goalSec;
    goalValue.textContent = `${state.goalSec}초`;
    const pct = ((state.goalSec - GOAL_SLIDER.min) / (GOAL_SLIDER.max - GOAL_SLIDER.min)) * 100;
    slider.style.setProperty('--pct', `${pct}%`);
    slider.setAttribute('aria-valuetext', `${state.goalSec}초`);
  }

  function render() {
    diffGroup.querySelectorAll('.choice').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.id === state.difficulty));
    });
    charGroup.querySelectorAll('.choice').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.id === state.character));
    });
    renderSlider();
  }

  diffGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (!btn) return;
    state.difficulty = btn.dataset.id;
    state.goalSec = DIFFICULTIES[state.difficulty].goalDefaultSec; // 난이도를 바꾸면 목표 시간은 기본값으로
    render();
  });

  charGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (!btn) return;
    state.character = btn.dataset.id;
    render();
  });

  slider.addEventListener('input', () => {
    state.goalSec = Number(slider.value);
    renderSlider();
  });

  const getSettings = () => ({ ...state });

  $('btn-begin').addEventListener('click', () => onStart(getSettings()));

  function reset() {
    state = { ...DEFAULT_SELECTION, goalSec: DIFFICULTIES[DEFAULT_SELECTION.difficulty].goalDefaultSec };
    render();
  }

  reset();
  return { reset, getSettings };
}

// ── 결과 화면 ──────────────────────────────────────
const fmt = (n) => n.toLocaleString('ko-KR');

// result: game.js의 buildResult가 만든 객체
function renderResult(result) {
  const met = result.goalMet;
  const over = Math.round((result.elapsedSec - result.goalSec) * 10) / 10;

  $('result-title').textContent = met ? '목표를 해냈어요!' : '끝까지 해냈어요!';
  // 목표 초과 시 격려 문구 (PRD 6장)
  $('result-sub').textContent = met ? '정말 잘하셨어요' : '괜찮아요. 다음엔 더 빨라질 거예요';
  $('result-time').textContent = `${result.elapsedSec}초`;
  // 색만으로 구분하지 않도록 ✓ / 문구를 함께 쓴다
  $('result-goal').textContent = met
    ? `목표 ${result.goalSec}초 · ✓ 달성`
    : `목표 ${result.goalSec}초 · ${over}초 초과`;
  $('result-score').textContent = `${fmt(result.score)}점`;

  const d = result.scoreDetail;
  $('result-detail').textContent =
    `시간점수 ${fmt(d.timeScore)} × ${d.multiplier.toFixed(1)} + 보너스 ${fmt(d.bonus)}`;
}

// ── 색종이 효과 ────────────────────────────────────
const CONFETTI_COLORS = ['#E53935', '#1E88E5', '#FDD835', '#43A047', '#8E24AA', '#FB8C00', '#EC407A'];
let confettiTimer = 0;

function clearConfetti() {
  clearTimeout(confettiTimer);
  const box = $('confetti');
  if (box) box.replaceChildren();
}

function launchConfetti() {
  clearConfetti();
  // 움직임을 줄이도록 설정한 사용자에게는 보여 주지 않는다
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('confetti');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.width = `${10 + Math.random() * 10}px`;
    piece.style.height = `${14 + Math.random() * 14}px`;
    piece.style.animationDuration = `${2.6 + Math.random() * 2}s`;
    piece.style.animationDelay = `${Math.random() * 1.2}s`;
    piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 240)}px`);
    frag.appendChild(piece);
  }
  box.appendChild(frag);
  confettiTimer = setTimeout(clearConfetti, 6500);
}

  Object.assign(window.MPG, { createSymbol, showScreen, initSetupScreen, renderResult, launchConfetti });
})();
