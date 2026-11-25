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
      startMusic();

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
    function tone({ freq, to, at = 0, dur = 0.15, type = 'triangle', gain = 0.3, attack = 0.012, out = master }) {
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
      amp.connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }

    // 종이 넘기는 소리용 바람 소리
    function swish({ at = 0, dur = 0.1, freq = 1200, gain = 0.3, out = master }) {
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
      amp.connect(out);
      src.start(t);
      src.stop(t + dur + 0.05);
    }


    // ── 배경 음악 (직접 작곡한 칩튠 풍 곡, 음원 파일 없이 합성) ─────────────
    const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function midiFreq(name) {
      const m = /^([A-G])(#|b)?(\d)$/.exec(name);
      const midi = 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
      return 440 * Math.pow(2, (midi - 69) / 12);
    }

    // "E5:2 G5:2 r:4" -> 16분음표 단위 길이의 음 목록. 쉼표는 r.
    function seq(text) {
      let step = 0;
      const notes = [];
      text.trim().split(/\s+/).forEach((tok) => {
        const [name, len] = tok.split(':');
        const n = Number(len);
        if (name !== 'r') notes.push({ step, name, len: n });
        step += n;
      });
      return { notes, steps: step };
    }

    // 곡 정의 -> 이벤트 목록 { t(초), fn(at, out) } 과 한 바퀴 길이
    function buildSong(def) {
      const stepSec = 60 / def.bpm / 4;
      const events = [];
      let total = 0;
      def.layers.forEach((layer) => {
        let offset = 0;
        layer.bars.forEach((barText) => {
          const { notes, steps } = seq(barText);
          notes.forEach((n) => {
            events.push({
              t: (offset + n.step) * stepSec,
              fn: (at, out) =>
                tone({ freq: midiFreq(n.name), at, dur: Math.max(0.08, n.len * stepSec * 0.92), type: layer.wave, gain: layer.gain, attack: 0.006, out }),
            });
          });
          offset += steps;
        });
        total = Math.max(total, offset);
      });
      if (def.drums) {
        for (let s = 0; s < total; s += 2) {
          const inBar = s % 16;
          if (inBar === 0 || inBar === 8) {
            events.push({ t: s * stepSec, fn: (at, out) => tone({ freq: 140, to: 45, at, dur: 0.12, type: 'sine', gain: 0.5, attack: 0.003, out }) });
          } else if (inBar === 4 || inBar === 12) {
            events.push({ t: s * stepSec, fn: (at, out) => swish({ at, dur: 0.08, freq: 3500, gain: 0.18, out }) });
          } else {
            events.push({ t: s * stepSec, fn: (at, out) => swish({ at, dur: 0.04, freq: 7500, gain: 0.07, out }) });
          }
        }
      }
      events.sort((a, b) => a.t - b.t);
      return { events, length: total * stepSec };
    }

    // 설정 화면: 경쾌하게 통통 튀는 8초짜리 인트로 (C - Am - F - G)
    const SETUP_SONG = {
      bpm: 128,
      drums: false,
      layers: [
        { wave: 'square', gain: 0.09, bars: [
          'E5:2 G5:2 C6:2 G5:2 E5:2 G5:2 C6:4',
          'A5:2 E5:2 C5:2 E5:2 A5:2 E5:2 A5:4',
          'F5:2 A5:2 C6:2 A5:2 F5:2 A5:2 C6:4',
          'D5:2 G5:2 B5:2 G5:2 D6:4 r:2 B5:2',
        ] },
        { wave: 'triangle', gain: 0.22, bars: [
          'C3:2 C4:2 C3:2 C4:2 C3:2 C4:2 C3:2 C4:2',
          'A2:2 A3:2 A2:2 A3:2 A2:2 A3:2 A2:2 A3:2',
          'F2:2 F3:2 F2:2 F3:2 F2:2 F3:2 F2:2 F3:2',
          'G2:2 G3:2 G2:2 G3:2 G2:2 G3:2 G2:2 G3:2',
        ] },
      ],
    };

    // 게임 화면: 24마디(약 45초)를 돌고 반복. 코러스(A) - 브리지(B) - 코러스+아르페지오(A')
    const A_MELODY = [
      'G5:3 B5:1 D6:2 B5:2 G5:3 B5:1 D6:4',
      'E5:3 G5:1 B5:2 G5:2 E5:3 G5:1 B5:4',
      'E5:3 G5:1 C6:2 G5:2 E5:3 G5:1 C6:4',
      'D5:3 F#5:1 A5:2 F#5:2 D5:2 F#5:2 A5:2 r:2',
      'B5:2 A5:2 G5:2 A5:2 B5:4 D6:4',
      'G5:2 F#5:2 E5:2 F#5:2 G5:4 B5:4',
      'A5:2 G5:2 E5:2 G5:2 A5:2 G5:2 E5:2 C5:2',
      'D5:4 F#5:4 A5:4 C6:2 B5:2',
    ];
    const B_MELODY = [
      'A5:2 C6:2 E6:4 C6:2 A5:2 E5:4',
      'D6:2 C6:2 A5:4 F#5:2 A5:2 D5:4',
      'B5:2 D6:2 G6:4 D6:2 B5:2 G5:4',
      'G5:2 B5:2 E6:4 B5:2 G5:2 E5:4',
      'C6:4 B5:2 A5:2 C6:4 E6:4',
      'F#6:4 E6:2 D6:2 A5:4 F#5:4',
      'G5:2 B5:2 D6:2 G6:2 F#6:2 D6:2 B5:2 G5:2',
      'A5:2 A5:2 A5:2 F#5:2 A5:4 D6:4',
    ];
    const bassBar = (lo, hi) => [lo, hi, lo, hi, lo, hi, lo, hi].map((n) => `${n}:2`).join(' ');
    const A_BASS = [['G2', 'G3'], ['E2', 'E3'], ['C3', 'C4'], ['D3', 'D4'], ['G2', 'G3'], ['E2', 'E3'], ['C3', 'C4'], ['D3', 'D4']].map(([l, h]) => bassBar(l, h));
    const B_BASS = [['A2', 'A3'], ['D3', 'D4'], ['G2', 'G3'], ['E2', 'E3'], ['A2', 'A3'], ['D3', 'D4'], ['G2', 'G3'], ['D3', 'D4']].map(([l, h]) => bassBar(l, h));
    const arpBar = (a, b, c) => [a, b, c, b, a, b, c, b, a, b, c, b, a, b, c, b].map((n) => `${n}:1`).join(' ');
    const A_ARP = [
      ['G4', 'B4', 'D5'], ['E4', 'G4', 'B4'], ['E4', 'G4', 'C5'], ['D4', 'F#4', 'A4'],
      ['G4', 'B4', 'D5'], ['E4', 'G4', 'B4'], ['E4', 'G4', 'C5'], ['D4', 'F#4', 'A4'],
    ].map(([a, b, c]) => arpBar(a, b, c));
    const REST_BAR = 'r:16';
    const GAME_SONG = {
      bpm: 128,
      drums: true,
      layers: [
        { wave: 'square', gain: 0.08, bars: [...A_MELODY, ...B_MELODY, ...A_MELODY] },
        { wave: 'triangle', gain: 0.22, bars: [...A_BASS, ...B_BASS, ...A_BASS] },
        { wave: 'sine', gain: 0.07, bars: [...Array(16).fill(REST_BAR), ...A_ARP] },
      ],
    };

    const SONGS = {};
    const songFor = (name) => {
      if (!SONGS[name]) SONGS[name] = buildSong(name === 'setup' ? SETUP_SONG : GAME_SONG);
      return SONGS[name];
    };

    let wantTrack = null; // 지금 화면이 원하는 곡 (null이면 무음)
    let playing = null; // { name, out, timer }
    const LOOKAHEAD = 0.6;

    function stopMusic() {
      if (!playing) return;
      const cur = playing;
      playing = null;
      clearInterval(cur.timer);
      try {
        cur.out.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
        setTimeout(() => cur.out.disconnect(), 600);
      } catch (e) {
        /* 무시 */
      }
    }

    function startMusic() {
      if (!enabled || !ctx || !wantTrack) return;
      if (playing && playing.name === wantTrack) return;
      stopMusic();
      const song = songFor(wantTrack);
      const out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(master);
      const cur = { name: wantTrack, out, timer: 0 };
      playing = cur;
      let loopStart = ctx.currentTime + 0.1;
      let i = 0;
      const pump = () => {
        const horizon = ctx.currentTime + LOOKAHEAD;
        while (loopStart + song.events[i].t < horizon) {
          const e = song.events[i];
          const at = Math.max(0, loopStart + e.t - ctx.currentTime);
          e.fn(at, out);
          i++;
          if (i >= song.events.length) {
            i = 0;
            loopStart += song.length;
          }
        }
      };
      pump();
      cur.timer = setInterval(pump, 150);
    }

    function setMusic(name) {
      wantTrack = name || null;
      if (!wantTrack) stopMusic();
      else startMusic();
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
      // 터지는 효과음: 짧은 '펑' + 반짝이는 높은 음
      pop: (d) => {
        tone({ freq: 300, to: 90, at: d, dur: 0.18, gain: 0.8, attack: 0.005 });
        swish({ at: d, dur: 0.18, freq: 2500, gain: 0.6 });
        [1047, 1319, 1568].forEach((f, k) => tone({ freq: f, at: d + 0.04 + k * 0.05, dur: 0.18, gain: 0.18, type: 'sine' }));
      },
      // 짝 불일치: 부드러운 낮은 음
      mismatch: (d) => tone({ freq: 311, to: 233, at: d, dur: 0.3, gain: 0.8, attack: 0.02 }),
      // 목표 시간 임박: 느린 알림음 1회
      warn: (d) => tone({ freq: 440, at: d, dur: 0.8, gain: 0.35, attack: 0.12 }),
      // 게임 클리어: 짧은 축하 팡파르
      clear: (d) => {
        // 약 2.5초 승리 팡파르 (직접 만든 곡): 빠른 상승 아르페지오 2번 -> 한 단계 올려 반복 -> 길게 울리는 마무리 화음
        const sq = (freq, at, dur, gain = 0.15) => tone({ freq, at: d + at, dur, type: 'square', gain, attack: 0.004 });
        const run1 = [523, 659, 784, 1047, 1319, 1568]; // C E G C E G
        const run2 = [587, 740, 880, 1175, 1480, 1760]; // D F# A D F# A (한 음 위)
        run1.forEach((f, k) => sq(f, k * 0.07, 0.1));
        sq(2093, 0.42, 0.18);
        run2.forEach((f, k) => sq(f, 0.7 + k * 0.07, 0.1));
        sq(2349, 1.12, 0.18);
        // 마무리: 짧게 두 번 친 뒤 길게 울리는 C 메이저 화음
        [[1047, 0.14], [1319, 0.14], [1568, 0.14]].forEach(([f, dur]) => sq(f, 1.5, dur, 0.13));
        [[1047, 0.14], [1319, 0.14], [1568, 0.14]].forEach(([f, dur]) => sq(f, 1.7, dur, 0.13));
        [1047, 1319, 1568, 2093].forEach((f) => sq(f, 1.9, 0.65, 0.12));
        tone({ freq: 262, at: d + 1.9, dur: 0.65, gain: 0.45, attack: 0.01 }); // 낮은 C 받침
        tone({ freq: 131, at: d + 1.9, dur: 0.65, gain: 0.35, attack: 0.01 });
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
      if (enabled) startMusic();
      else stopMusic();
      try {
        sessionStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
      } catch (e) {
        /* 저장 실패는 무시 */
      }
    }

    return { unlock, resume, play, setMusic, setEnabled, isEnabled: () => enabled };
  }

  Object.assign(window.MPG, { createSound });
})();
