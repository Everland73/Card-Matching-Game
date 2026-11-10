// 효과음: 음원 파일 없이 Web Audio API로 합성한다.
// 모두 짧고 부드럽게(사인/삼각파, 작은 음량, 최고 약 1kHz) 만든다. 날카로운 고음·큰 경고음 없음.
(function () {
  'use strict';

  const STORAGE_KEY = 'mpg-sound'; // 같은 세션(탭) 안에서만 유지 (sessionStorage)

  function createSound() {
    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let enabled = true;

    try {
      if (sessionStorage.getItem(STORAGE_KEY) === 'off') enabled = false;
    } catch (e) {
      /* 저장소를 못 쓰면 기본값(켜짐) */
    }

    // 브라우저는 사용자 탭 전에 소리를 막는다. "게임 시작" 탭에서 한 번 호출한다.
    function unlock() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    }

    // 음 하나: 부드럽게 시작(attack)하고 서서히 사라진다.
    function tone({ freq, to, at = 0, dur = 0.15, type = 'sine', gain = 0.1, attack = 0.012 }) {
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(amp);
      amp.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    // 종이 넘기는 소리용 바람 소리
    function swish({ at = 0, dur = 0.09, freq = 900, gain = 0.07 }) {
      if (!noiseBuffer) {
        noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const t = ctx.currentTime + at;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = freq;
      filter.Q.value = 0.8;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(amp);
      amp.connect(master);
      src.start(t);
      src.stop(t + dur + 0.05);
    }

    // PRD 6장 표의 상황별 소리. d = 시작을 늦출 시간(초)
    const SOUNDS = {
      // 버튼 탭: 짧고 가벼운 클릭음
      click: (d) => tone({ freq: 520, to: 400, at: d, dur: 0.06, gain: 0.07 }),
      // 미리보기 카운트다운: 틱
      tick: (d) => tone({ freq: 600, at: d, dur: 0.07, gain: 0.08, type: 'triangle' }),
      // 패가 덮일 때: 낮은 소리
      cover: (d) => tone({ freq: 196, to: 147, at: d, dur: 0.22, gain: 0.14 }),
      // 패 뒤집기: 카드 넘기는 소리
      flip: (d) => {
        swish({ at: d });
        tone({ freq: 330, to: 220, at: d, dur: 0.07, gain: 0.04, type: 'triangle' });
      },
      // 짝 일치: 밝은 성공음 (도-미-솔)
      match: (d) => {
        tone({ freq: 523, at: d, dur: 0.16, gain: 0.11 });
        tone({ freq: 659, at: d + 0.1, dur: 0.16, gain: 0.11 });
        tone({ freq: 784, at: d + 0.2, dur: 0.28, gain: 0.11 });
      },
      // 짝 불일치: 부드러운 낮은 음
      mismatch: (d) => tone({ freq: 233, to: 175, at: d, dur: 0.3, gain: 0.1, type: 'triangle', attack: 0.03 }),
      // 목표 시간 임박: 느린 알림음 1회
      warn: (d) => tone({ freq: 392, at: d, dur: 0.7, gain: 0.1, attack: 0.15 }),
      // 게임 클리어: 짧은 축하 팡파르
      clear: (d) => {
        tone({ freq: 392, at: d, dur: 0.14, gain: 0.1 });
        tone({ freq: 523, at: d + 0.14, dur: 0.14, gain: 0.1 });
        tone({ freq: 659, at: d + 0.28, dur: 0.14, gain: 0.1 });
        [523, 659, 784].forEach((f) => tone({ freq: f, at: d + 0.42, dur: 0.7, gain: 0.06, attack: 0.03 }));
      },
      // 목표 시간 초과 클리어: 차분한 완료음
      clearSlow: (d) => {
        tone({ freq: 392, at: d, dur: 0.4, gain: 0.09, attack: 0.04 });
        tone({ freq: 523, at: d + 0.3, dur: 0.6, gain: 0.09, attack: 0.04 });
      },
    };

    // 소리가 꺼져 있거나 아직 unlock 전이면 아무것도 하지 않는다.
    function play(name, delaySec = 0) {
      if (!enabled || !ctx || !SOUNDS[name]) return;
      SOUNDS[name](delaySec);
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      try {
        sessionStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch (e) {
        /* 저장 실패는 무시 */
      }
    }

    return { unlock, play, setEnabled, isEnabled: () => enabled };
  }

  Object.assign(window.MPG, { createSound });
})();
