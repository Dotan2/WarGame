'use strict';
// Procedural audio, no sound files:
// - adaptive music whose layers and tempo follow the match phase (menu, play, zone, sudden death)
// - a heartbeat that speeds up with danger
// - sound effects with random pitch variation and stereo position
// - ducking: the music dips under big moments
(() => {
  const GC = window.GC;
  let ac = null, master, comp, musicBus, duckBus, sfxBus, noiseBuf = null;
  const vol = { music: 0.6, sfx: 0.8 };
  let muted = false, level = null, danger = 0, step = 0, nextT = 0, beatT = 0;

  const BPM = [92, 112, 120, 138];
  // A minor progression: Am F C G, one bar each (16 sixteenth steps)
  const BARS = [{ root: 45, chord: [0, 3, 7] }, { root: 41, chord: [0, 4, 7] }, { root: 48, chord: [0, 4, 7] }, { root: 43, chord: [0, 4, 7] }];
  const mtof = n => 440 * Math.pow(2, (n - 69) / 12);
  const vary = (a = 0.04) => 1 + (Math.random() * 2 - 1) * a;

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; }
    comp = ac.createDynamicsCompressor();
    master = ac.createGain();
    master.connect(comp); comp.connect(ac.destination);
    musicBus = ac.createGain(); duckBus = ac.createGain();
    musicBus.connect(duckBus); duckBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVol();
    setInterval(schedule, 25);
    return ac;
  }
  function applyVol() {
    if (!ac) return;
    master.gain.value = muted ? 0 : 1;
    musicBus.gain.value = vol.music * 0.9;
    sfxBus.gain.value = vol.sfx;
  }

  function out(bus, node, pan) {
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(bus); }
    else node.connect(bus);
  }
  function tone(bus, t, freq, dur, type, v, o = {}) {
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + o.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); out(bus, g, o.pan);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  function noise(bus, t, dur, v, o = {}) {
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noiseBuf;
    f.type = o.type || 'highpass'; f.frequency.value = o.freq || 6000;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); out(bus, g, o.pan);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  const arp = (t, notes, gap, type, v, o) => notes.forEach((f, i) => tone(sfxBus, t + i * gap, f, o.dur || 0.12, type, v, o));

  // ---------- music ----------
  function musicStep(s, t) {
    const bar = BARS[(s >> 4) % 4], k = s % 16, L = level;
    const kick = () => { tone(musicBus, t, 130, 0.16, 'sine', 0.5, { slide: -95 }); };
    if (k % 4 === 0 || k === 6) tone(musicBus, t, mtof(bar.root), 0.22, 'triangle', L === 0 ? 0.12 : 0.16);
    if (L === 0) {
      if (k % 4 === 2) tone(musicBus, t, mtof(bar.root + 24 + bar.chord[(s >> 2) % 3]), 0.35, 'sine', 0.03);
      return;
    }
    if (L >= 3 ? k % 4 === 0 : (k === 0 || k === 8 || k === 10)) kick();
    if (k % 4 === 2) noise(musicBus, t, 0.04, L >= 2 ? 0.06 : 0.04);
    if (L >= 3 && k % 2 === 1) noise(musicBus, t, 0.025, 0.025);
    if (L >= 2 && (k === 4 || k === 12)) noise(musicBus, t, 0.12, 0.12, { freq: 1800 });
    const every = L >= 3 ? 1 : 2;
    if (L >= 2 && k % every === 0) {
      const n = bar.root + 24 + bar.chord[(k / every) % 3] + (k >= 8 ? 12 : 0);
      tone(musicBus, t, mtof(n), 0.09, 'square', 0.025);
    }
    if (L === 1 && k === 14) tone(musicBus, t, mtof(bar.root + 31), 0.2, 'sine', 0.03);
  }

  function heartbeat(t) {
    const v = 0.35 + danger * 0.5;
    tone(sfxBus, t, 70, 0.12, 'sine', v, { slide: -30 });
    tone(sfxBus, t + 0.13, 62, 0.1, 'sine', v * 0.6, { slide: -25 });
  }

  function schedule() {
    if (!ac) return;
    const now = ac.currentTime;
    if (level !== null) {
      if (nextT < now) nextT = now + 0.03;
      while (nextT < now + 0.12) { musicStep(step, nextT); nextT += 60 / BPM[level] / 4; step = (step + 1) % 64; }
    }
    if (danger > 0.08) {
      if (beatT < now) beatT = now + 0.02;
      while (beatT < now + 0.12) { heartbeat(beatT); beatT += 60 / (70 + 120 * danger); }
    }
  }

  function duck(depth = 0.3, hold = 0.45) {
    if (!ac) return;
    const g = duckBus.gain, t = ac.currentTime;
    g.cancelScheduledValues(t); g.setTargetAtTime(depth, t, 0.03); g.setTargetAtTime(1, t + hold, 0.3);
  }

  // ---------- effects ----------
  const SFX = {
    claim: (t, o) => { const s = o.size || 0; tone(sfxBus, t, 520 * vary(), 0.09, 'square', 0.05, { slide: 380 + s * 30, pan: o.pan }); if (s >= 3) tone(sfxBus, t + 0.06, 780 * vary(), 0.14, 'triangle', 0.06, { slide: 500, pan: o.pan }); },
    claimRival: (t, o) => tone(sfxBus, t, 260 * vary(0.1), 0.06, 'triangle', 0.025, { slide: 80, pan: o.pan }),
    landLost: (t, o) => tone(sfxBus, t, 330 * vary(), 0.2, 'sawtooth', 0.04, { slide: -180, pan: o.pan }),
    ko: (t, o) => { noise(sfxBus, t, 0.2, 0.15, { freq: 1200, pan: o.pan }); arp(t, [880, 1320].map(f => f * vary(0.02)), 0.09, 'triangle', 0.08, { pan: o.pan, dur: 0.18 }); duck(); },
    koYou: (t, o) => { noise(sfxBus, t, 0.4, 0.2, { freq: 400, type: 'lowpass', pan: o.pan }); tone(sfxBus, t, 300, 0.55, 'sawtooth', 0.1, { slide: -250 }); duck(0.2, 0.8); },
    koOther: (t, o) => { noise(sfxBus, t, 0.15, 0.06, { freq: 900, pan: o.pan }); tone(sfxBus, t, 200 * vary(0.1), 0.12, 'square', 0.03, { slide: -100, pan: o.pan }); },
    trap: (t, o) => { tone(sfxBus, t, 200 * vary(), 0.32, 'square', 0.07, { slide: 300, pan: o.pan }); duck(); },
    dash: (t, o) => { noise(sfxBus, t, 0.25, 0.09, { freq: 2500, pan: o.pan }); tone(sfxBus, t, 600 * vary(), 0.15, 'triangle', 0.06, { slide: 400, pan: o.pan }); },
    shield: (t, o) => { tone(sfxBus, t, 400 * vary(), 0.3, 'sine', 0.09, { slide: 400, pan: o.pan }); tone(sfxBus, t + 0.05, 600, 0.25, 'triangle', 0.04, { pan: o.pan }); },
    freeze: (t, o) => arp(t, [1100, 1480, 1760].map(f => f * vary(0.02)), 0.04, 'sine', 0.06, { pan: o.pan, dur: 0.2 }),
    frozen: (t, o) => tone(sfxBus, t, 1200, 0.25, 'sine', 0.08, { slide: -700, pan: o.pan }),
    bump: (t, o) => tone(sfxBus, t, 150 * vary(), 0.1, 'square', 0.06, { pan: o.pan }),
    zone: () => { noise(sfxBus, ac.currentTime, 0.3, 0.05, { freq: 300, type: 'lowpass' }); tone(sfxBus, ac.currentTime, 90, 0.2, 'sawtooth', 0.04); },
    sudden: t => { tone(sfxBus, t, 220, 0.7, 'sawtooth', 0.09, { slide: -110 }); tone(sfxBus, t, 110, 0.7, 'square', 0.05); duck(0.2, 1); },
    close: (t, o) => tone(sfxBus, t, o.mine ? 660 : 330, 0.3, 'square', 0.06, { slide: o.mine ? 220 : -100 }),
    orb: (t, o) => arp(t, [880, 1109, 1319].map(f => f * vary(0.02)), 0.05, 'sine', 0.07, { pan: o.pan, dur: 0.12 }),
    surge: (t, o) => arp(t, [659, 880, 1109, 1319, 1760], 0.05, 'triangle', 0.07, { pan: o.pan, dur: 0.15 }),
    streak: (t, o) => { arp(t, [784, 988, 1175, 1568], 0.07, 'square', 0.06, { pan: o.pan, dur: 0.14 }); duck(0.2, 0.6); },
    revenge: (t, o) => { tone(sfxBus, t, 440, 0.3, 'sawtooth', 0.07, { slide: 440, pan: o.pan }); duck(); },
    closeCall: (t, o) => tone(sfxBus, t, 900 * vary(), 0.18, 'triangle', 0.06, { slide: -300, pan: o.pan }),
    crown: (t, o) => { tone(sfxBus, t, 660, 0.3, 'triangle', 0.06, { pan: o.pan }); tone(sfxBus, t + 0.08, 880, 0.35, 'triangle', 0.06, { pan: o.pan }); },
    crownLost: t => tone(sfxBus, t, 520, 0.35, 'triangle', 0.06, { slide: -200 }),
    tick: t => tone(sfxBus, t, 440, 0.1, 'square', 0.06),
    go: t => tone(sfxBus, t, 880, 0.22, 'square', 0.07),
    win: t => { arp(t, [523, 659, 784, 1047], 0.12, 'triangle', 0.08, { dur: 0.2 }); duck(0.15, 1.2); },
    lose: t => { arp(t, [523, 466, 415, 349], 0.16, 'triangle', 0.07, { dur: 0.25 }); duck(0.15, 1.2); },
    ui: t => tone(sfxBus, t, 660, 0.04, 'sine', 0.05),
    uiOk: t => tone(sfxBus, t, 880, 0.08, 'triangle', 0.07, { slide: 200 }),
    xp: (t, o) => tone(sfxBus, t, 900 + (o.p || 0) * 700, 0.03, 'sine', 0.03),
    levelup: t => { arp(t, [523, 659, 784, 1047, 1319, 1568], 0.07, 'triangle', 0.08, { dur: 0.2 }); duck(0.2, 1); },
    achieve: t => { arp(t, [784, 1175], 0.1, 'square', 0.05, { dur: 0.25 }); arp(t + 0.05, [988, 1397], 0.1, 'triangle', 0.04, { dur: 0.25 }); },
  };

  GC.audio = {
    unlock: ensure,
    // o.x: grid x of the sound, used for stereo position
    play(name, o = {}) {
      if (!ac || muted || !SFX[name]) return;
      if (o.x !== undefined && o.W) o.pan = (o.x / o.W * 2 - 1) * 0.7;
      try { SFX[name](ac.currentTime + (o.delay || 0), o); } catch (_) { /* audio node limits */ }
    },
    // 0 menu, 1 play, 2 zone, 3 sudden death, null = silence
    setMusic(l) { if (l !== level) { if (l !== null && level === null) step = 0; level = l; } },
    setDanger(v) { danger = v; },
    setVolume(kind, v) { vol[kind] = v; applyVol(); },
    toggleMute() { muted = !muted; applyVol(); return muted; },
    get muted() { return muted; },
  };
})();
