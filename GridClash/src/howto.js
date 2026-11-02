'use strict';
// "How to play" examples: tiny scripted matches running on the real simulation and renderer,
// so every example shows exactly what the game does.
(() => {
  const GC = window.GC, base = window.GC_CONFIG;
  const YOU = { name: 'YOU', color: base.players[0].color }, RIVAL = { name: 'RIVAL', color: base.players[1].color };

  const mini = sc => ({
    ...base, gridW: 40, gridH: 26, cell: 6, speed: 15, rewindSpeed: 15, baseSize: 5,
    respawnDelay: 1e9, matchSeconds: 1e9, suddenDeath: 0, winPercent: 101, abilityCooldown: 0.1,
    zone: { ...base.zone, start: 1e9 }, orbs: { ...base.orbs, first: 1e9 }, crownAfter: 1e9,
    players: sc.players, spots: sc.spots,
  });

  // script commands: [dir, cells] | { wait: ticks } | { ability }
  const SCENARIOS = [
    {
      title: 'Claim land',
      text: 'Hold <b>Space</b> and steer out of your land: you draw a line. Get back to your land and everything inside the loop becomes yours.',
      players: [YOU], spots: [[0.25, 0.5]],
      scripts: [[['up', 7], ['right', 8], ['down', 7], ['left', 6], { wait: 100 }]],
    },
    {
      title: 'Cut a rival line',
      text: `While a rival draws, their line is their weak spot. Cross it and they are knocked out. You take <b>${base.killTransfer * 100}%</b> of their land (the part nearest you), and the rest becomes free.`,
      players: [YOU, RIVAL], spots: [[0.25, 0.5], [0.75, 0.5]],
      scripts: [
        [{ wait: 20 }, ['right', 10], ['up', 9], ['left', 10], ['down', 7], { wait: 100 }],
        [['up', 7], ['left', 12], { wait: 1e9 }],
      ],
    },
    {
      title: 'Trap a rival',
      text: 'Enclose a rival who is sitting safe on their land. They are not knocked out, but <b>all their land is erased</b> and they are thrown to the center, exposed.',
      players: [YOU, RIVAL], spots: [[0.25, 0.5], [0.6, 0.5]],
      scripts: [[['up', 6], ['right', 20], ['down', 12], ['left', 20], ['up', 4], { wait: 120 }], [{ wait: 1e9 }]],
    },
    {
      title: 'Shield  (X, 40 energy)',
      text: 'For 2 seconds your line cannot be cut. Whoever hits it bounces off and is <b>SLOWED</b>. Here the rival shields, so you bounce until the shield runs out.',
      players: [YOU, RIVAL], spots: [[0.25, 0.5], [0.75, 0.5]],
      setup: m => { m.players[1].energy = 100; },
      scripts: [
        [{ wait: 20 }, ['right', 10], ['up', 9], ['left', 10], ['down', 7], { wait: 100 }],
        [['up', 7], ['left', 12], { ability: 'shield' }, { wait: 1e9 }],
      ],
    },
    {
      title: 'Freeze (C, 50)  +  Dash (Z, 25)',
      text: '<b>Freeze</b> stops the nearest rival for 1s, and picks one who is drawing first. <b>Dash</b> doubles your speed for 1.2s, but you can\'t stop. Freeze a rival, then dash to cut their line.',
      players: [YOU, RIVAL], spots: [[0.25, 0.5], [0.75, 0.5]],
      setup: m => { m.players[0].energy = 100; },
      scripts: [
        [{ wait: 60 }, { ability: 'freeze' }, { wait: 7 }, { ability: 'dash' }, ['right', 15], ['up', 9], ['left', 15], ['down', 7], { wait: 100 }],
        [['up', 7], ['left', 24], { wait: 1e9 }],
      ],
    },
    {
      title: 'Energy cells',
      text: 'Glowing cells appear on free land. Draw over one or enclose it to collect <b>energy</b> (never land). Gold cells give more.',
      players: [YOU], spots: [[0.25, 0.5]],
      setup: m => { GC.addOrb(m, 14, 10, 'energy'); GC.addOrb(m, 16, 8, 'surge'); },
      scripts: [[{ wait: 30 }, ['up', 6], ['right', 8], ['down', 6], ['left', 6], { wait: 100 }]],
    },
  ];

  function makeDemo(sc, canvas) {
    const cfg = mini(sc), R = GC.createRenderer(canvas, cfg);
    const log = []; // event history, read by tests
    let m, st;
    function reset() {
      m = GC.createMatch(cfg, 7);
      if (sc.setup) sc.setup(m);
      st = m.players.map((p, i) => ({ cmds: (sc.scripts[i] || []).map(c => (Array.isArray(c) ? { dir: c[0], n: c[1] } : { ...c })), i: 0, s0: -1 }));
    }
    function inputFn(p) {
      const s = st[p.id], c = s.cmds[s.i], o = { dir: null, cut: true, ability: null };
      if (!c) return o;
      if (c.dir) { if (s.s0 < 0) s.s0 = p.steps; o.dir = c.dir; }
      if (c.ability && !c.done) { o.ability = c.ability; c.done = true; }
      return o;
    }
    function tick(dt) {
      m.players.forEach((p, i) => {
        const s = st[i], c = s.cmds[s.i];
        if (!c) return;
        if (c.wait != null) { if (--c.wait <= 0) s.i++; }
        else if (c.ability) { if (c.done) s.i++; }
        else if (s.s0 >= 0 && p.steps - s.s0 >= c.n) { s.i++; s.s0 = -1; }
      });
      if (st[0].i >= st[0].cmds.length) reset();
      GC.step(m, dt, inputFn);
      for (const e of m.events) log.push(e.type + (e.kind ? ':' + e.kind : ''));
      R.fxEvents(m, m.events, { humanId: 0, quiet: true });
      m.events.length = 0;
      R.update(dt);
    }
    reset();
    return { tick, draw: () => R.draw(m, 0), get match() { return m; }, log };
  }

  let demos = null;
  const el = () => document.getElementById('howto');
  function build() {
    const grid = document.getElementById('howtoDemos');
    demos = SCENARIOS.map(sc => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<canvas></canvas><h3>${sc.title}</h3><p>${sc.text}</p>`;
      grid.appendChild(card);
      return makeDemo(sc, card.querySelector('canvas'));
    });
  }

  GC.howto = {
    open() { if (!demos) build(); el().classList.add('open'); },
    close() { el().classList.remove('open'); },
    isOpen: () => el().classList.contains('open'),
    get demos() { return demos; },
    update(dt) { if (demos) demos.forEach(d => d.tick(dt)); },
    render() { if (demos) demos.forEach(d => d.draw()); },
  };
})();
