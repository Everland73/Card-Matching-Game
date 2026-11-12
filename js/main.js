(function () {
  'use strict';
  const { showScreen, initSetupScreen, renderResult, launchConfetti, createPlay, createSound } = window.MPG;

  // 진입점: 화면과 소리를 연결한다.
  const sound = createSound();
  let lastSettings = null; // "다시 하기"가 같은 설정으로 새 게임을 시작할 때 쓴다

  const play = createPlay({
    sound,
    onFinish(result) {
      // [2단계 확장 지점] 플레이어 기록·순위 저장은 여기서 result를 저장소에 넘기면 된다.
      //   result = { difficulty, character, elapsedSec, goalSec, score, playedAt, ... }
      //   (결과 객체는 js/game.js의 buildResult 한 곳에서만 만들어진다. 화면 코드는 고칠 필요 없음)
      renderResult(result);
      showScreen('result');
      if (result.goalMet) launchConfetti(); // 목표 시간 안에 끝냈을 때만 색종이
    },
    onExit() {
      openSetup();
    },
  });

  function startGame(settings) {
    lastSettings = settings;
    showScreen('game');
    play.start(settings);
  }

  const setup = initSetupScreen({ onStart: startGame });

  function openSetup() {
    setup.reset(); // 설정 화면은 매번 기본값(중, 과일)에서 시작
    showScreen('setup');
  }

  // 첫 소리는 "게임 시작" 탭 이후에 재생한다 (브라우저 자동재생 제한). 이 핸들러가 소리를 연다.
  document.getElementById('btn-open-setup').addEventListener('click', () => {
    sound.unlock();
    openSetup();
  });
  document.getElementById('btn-retry').addEventListener('click', () => {
    if (lastSettings) startGame(lastSettings);
    else openSetup();
  });
  document.getElementById('btn-home').addEventListener('click', openSetup);
  document.getElementById('btn-setup-exit').addEventListener('click', () => showScreen('start'));

  // 소리 켜기/끄기 버튼은 모든 화면에 있고, 같은 상태를 보여 준다.
  const soundButtons = document.querySelectorAll('.js-sound');
  function renderSoundButtons() {
    const on = sound.isEnabled();
    soundButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(on));
      btn.querySelector('.sound-icon').textContent = on ? '🔊' : '🔇';
      btn.querySelector('.sound-text').textContent = on ? '소리 켜짐' : '소리 꺼짐';
    });
  }
  renderSoundButtons();

  document.addEventListener('click', (e) => {
    sound.resume(); // 기기가 오디오를 멈췄다면(탭 전환·전화 등) 탭할 때 다시 깨운다
    if (e.target.closest('.js-sound')) {
      sound.setEnabled(!sound.isEnabled());
      renderSoundButtons();
    }
    // 버튼 탭 소리 (패는 뒤집는 소리가 따로 있다)
    if (e.target.closest('button') && !e.target.closest('.card')) sound.play('click');
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sound.resume();
  });

  showScreen('start');
})();
