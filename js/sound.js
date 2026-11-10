// 효과음: 음원 파일 없이 Web Audio API로 합성한다.
// 부드럽게(사인/삼각파, 짧은 길이, 최고 약 800Hz) 만들되, 태블릿·폰의 작은 스피커에서도 들리도록
// 음량을 충분히 주고(컴프레서로 튀는 소리 방지) 낮은 음은 배음이 있는 삼각파로 만든다.
(function () {
  'use strict';

  const STORAGE_KEY = 'mpg-sound'; // 같은 세션(탭) 안에서만 유지 (sessionStorage)

  const isIOS = () =>
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS는 Mac으로 보고함

  // 소리 없는 짧은 WAV (iOS 구형 무음 스위치 우회용 <audio>에 쓴다)
  function silentWavUrl() {
    const sampleRate = 8000;
    const samples = 4000;
    const buf = new ArrayBuffer(44 + samples);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    v.setUint32(4, 36 + samples, true);
    str(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate, true);
    v.setUint16(32, 1, true);
    v.setUint16(34, 8, true); // 8bit
    str(36, 'data');
    v.setUint32(40, samples, true);
    new Uint8Array(buf, 44).fill(128); // 8bit 무음 = 128
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function createSound() {
    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let keepAlive = null;
    let enabled = true;

    try {
      if (sessionStorage.getItem(STORAGE_KEY) === 'off') enabled = false;
    } catch (e) {
      /* 저장소를 못 쓰면 기본값(켜짐) */
    }

    // 정지(suspended)·중단(interrupted)된 오디오를 다시 깨운다. 사용자 탭 안에서 불러야 성공한다.
    function resume() {
      if (!ctx || ctx.state === 'running') return;
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {
        /* 무시 */
      }
    }

    // 브라우저는 사용자 탭 전에 소리를 막는다. "게임 시작" 탭에서 한 번 호출한다.
    function unlock() {
      // iOS 무음 스위치가 켜져 있어도 소리가 나도록 오디오 세션을 '재생'으로 (iOS 16.4+)
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch (e) {
        /* 무시 */
      }

      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        // 음량 → 컴프레서(갑자기 커지는 소리 방지) → 스피커
        master = ctx.createGain();
        master.gain.value = 0.9;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.003;
        comp.release.value = 0.2;
        master.connect(comp);
        comp.connect(ctx.destination);
      }
      resume();

      // 같은 탭 안에서 짧은 무음을 재생해 오디오 장치를 완전히 깨운다 (iOS Safari)
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, 22050);
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) {
        /* 무시 */
      }

      // 구형 iOS(16.4 미만)는 오디오 세션 설정이 없어서, 무음 <audio>를 돌려 무음 스위치를 우회한다
      if (!keepAlive && !navigator.audioSession && isIOS()) {
        try {
          keepAlive = new Audio(silentWavUrl());
          keepAlive.loop = true;
          keepAlive.setAttribute('playsinline', '');
          const p = keepAlive.play();
          if (p && p.catch) p.catch(() => {});
        } catch (e) {
          /* 무시 */
        }
      }
    }

    // 음 하나: 부드럽게 시작(attack)하고 서서히 사라진다.
    function tone({ freq, to, at = 0, dur = 0.15, type = 'triangle', gain = 0.3, attack = 0.012 }) {
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
    function swish({ at = 0, dur = 0.1, freq = 1200, gain = 0.3 }) {
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
      click: (d) => tone({ freq: 700, to: 520, at: d, dur: 0.07, gain: 0.7 }),
      // 미리보기 카운트다운: 틱
      tick: (d) => tone({ freq: 660, at: d, dur: 0.08, gain: 0.7 }),
      // 패가 덮일 때: 낮은 소리
      cover: (d) => tone({ freq: 247, to: 185, at: d, dur: 0.28, gain: 0.9 }),
      // 패 뒤집기: 카드 넘기는 소리
      flip: (d) => {
        swish({ at: d, gain: 0.8 });
        tone({ freq: 420, to: 280, at: d, dur: 0.08, gain: 0.3 });
      },
      // 짝 일치: 밝은 성공음 (도-미-솔)
      match: (d) => {
        tone({ freq: 523, at: d, dur: 0.16, gain: 0.3 });
        tone({ freq: 659, at: d + 0.1, dur: 0.16, gain: 0.3 });
        tone({ freq: 784, at: d + 0.2, dur: 0.3, gain: 0.3 });
      },
      // 짝 불일치: 부드러운 낮은 음
      mismatch: (d) => tone({ freq: 311, to: 233, at: d, dur: 0.3, gain: 0.8, attack: 0.02 }),
      // 목표 시간 임박: 느린 알림음 1회
      warn: (d) => tone({ freq: 440, at: d, dur: 0.8, gain: 0.35, attack: 0.12 }),
      // 게임 클리어: 짧은 축하 팡파르
      clear: (d) => {
        tone({ freq: 392, at: d, dur: 0.14, gain: 0.3 });
        tone({ freq: 523, at: d + 0.14, dur: 0.14, gain: 0.3 });
        tone({ freq: 659, at: d + 0.28, dur: 0.14, gain: 0.3 });
        [523, 659, 784].forEach((f) => tone({ freq: f, at: d + 0.42, dur: 0.8, gain: 0.15, attack: 0.03 }));
      },
      // 목표 시간 초과 클리어: 차분한 완료음
      clearSlow: (d) => {
        tone({ freq: 392, at: d, dur: 0.5, gain: 0.3, attack: 0.04 });
        tone({ freq: 523, at: d + 0.3, dur: 0.7, gain: 0.3, attack: 0.04 });
      },
    };

    // 소리가 꺼져 있거나 아직 unlock 전이면 아무것도 하지 않는다.
    function play(name, delaySec = 0) {
      if (!enabled || !ctx || !SOUNDS[name]) return;
      resume(); // 중간에 멈춘 오디오가 있으면 깨운다 (탭 안에서 불리면 성공)
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

    return { unlock, resume, play, setEnabled, isEnabled: () => enabled };
  }

  Object.assign(window.MPG, { createSound });
})();
