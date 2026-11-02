'use strict';
(() => {
  const GC = window.GC, cfg = window.GC_CONFIG, I = GC.input, A = GC.audio, PF = GC.profile, UI = GC.ui;
  const DEBUG = new URLSearchParams(location.search).has('debug');
  const R = GC.createRenderer(document.getElementById('game'), cfg);
  const HUMAN = 0;
  const ABILITIES = ['dash', 'shield', 'freeze'];
  const MENU_MODES = new Set(['menu', 'settings', 'collection']);
  const clamp01 = u => (u < 0 ? 0 : u > 1 ? 1 : u);

  const S = { mode: 'menu', modeT: 0, m: null, attract: null, back: 'menu', tutorial: false, hitstop: 0, danger: 0, stats: null, tut: null, resultsShown: false };
  window.__gc = S;
  const previewMask = new Uint8Array(cfg.gridW * cfg.gridH);

  // ---------- settings and audio ----------
  function applySettings() {
    const st = PF.data.settings;
    A.setVolume('music', st.music); A.setVolume('sfx', st.sfx);
    R.setOptions({ shake: st.shake });
  }
  applySettings();
  I.onKey(() => A.unlock()); // browsers only allow audio after a user gesture
  addEventListener('pointerdown', () => A.unlock());
  addEventListener('blur', () => { if (S.mode === 'play') S.mode = 'paused'; });
  const snd = (name, o = {}) => A.play(name, { W: cfg.gridW, ...o });

  let pendingAbility = null;
  function inputFn(p, m) {
    if (p.isBot) return GC.botThink(p, m);
    return { dir: I.dir(), cut: I.held('cut'), ability: pendingAbility };
  }

  // ---------- DOM helpers ----------
  const $ = id => document.getElementById(id);
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const tag = p => `<b style="color:${css(p.color)}">${p.name}</b>`;
  // restart a CSS animation class
  const anim = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  function floatChip(parent, text, cls) {
    const s = document.createElement('span');
    s.className = 'chip ' + cls; s.textContent = text;
    s.addEventListener('animationend', () => s.remove());
    parent.appendChild(s);
  }
  const feedEl = $('feed'), timeEl = $('hTime'), phaseEl = $('hPhase'), boardEl = $('board'), energyEl = $('hEnergy'), abilEl = $('abilities'), leadEl = $('hLead');
  const energyWrap = energyEl.parentElement;
  $('ruleWin').textContent = cfg.winPercent + '%';

  function feed(html) {
    const d = document.createElement('div');
    d.innerHTML = html; d.className = 'in';
    feedEl.prepend(d);
    while (feedEl.children.length > 5) feedEl.lastChild.remove();
  }

  // ---------- guided first match ----------
  const TUT = [
    { text: 'Hold <b>SPACE</b> and steer out of your land to draw a line', done: t => t.drew },
    { text: 'The striped ghost shows what you would get. Get back to your land to <b>claim</b> it', done: t => t.claims >= 1 },
    { text: 'Nice! Claim 2 more times. Long lines grab more, but rivals can cut them', done: t => t.claims >= 3 },
    { text: 'Grab the glowing <b>energy cell</b>: draw over it or enclose it', done: t => t.orbs >= 1, skipAfter: 30 },
    { text: 'Energy buys abilities: <b>Z</b> Dash, <b>X</b> Shield, <b>C</b> Freeze. Try one', done: t => t.abilities >= 1, skipAfter: 25 },
    { text: 'A rival line is their weak spot. <b>Cross it</b> to knock them out and take half their land', done: t => t.kills >= 1, skipAfter: 40 },
    { text: `You've got it. First to <b>${cfg.winPercent}%</b> wins!`, done: t => t.stepT > 6 },
  ];
  function stepTutorial(dt) {
    const t = S.tut;
    if (!S.tutorial || t.step >= TUT.length) return;
    t.drew = t.drew || S.m.players[HUMAN].drawing;
    t.stepT += dt;
    const st = TUT[t.step];
    if (st.done(t) || (st.skipAfter && t.stepT > st.skipAfter)) {
      t.step++; t.stepT = 0;
      if (t.step < TUT.length) snd('uiOk');
      UI.hint(t.step < TUT.length ? TUT[t.step].text : null);
    }
  }

  // ---------- events: sound, feed, stats (visuals live in the renderer) ----------
  function handleEvents(m) {
    const P = m.players, st = S.stats, tu = S.tut;
    const pct = c => (c / m.aliveCells * 100).toFixed(1);
    for (const e of m.events) {
      const who = P[e.who], mine = e.who === HUMAN, at = { x: e.x };
      switch (e.type) {
        case 'claim': {
          const v = e.gained / m.aliveCells * 100;
          if (mine) {
            snd('claim', { size: v, x: e.x });
            st.bigClaim = Math.max(st.bigClaim, v); tu.claims++;
            if (e.closeCall) { st.closeCalls++; snd('closeCall', at); }
          } else snd('claimRival', at);
          const lost = e.losses[HUMAN] || 0;
          if (lost / m.aliveCells * 100 >= 0.3) { snd('landLost', at); feed(`${tag(who)} took <span class="down">-${pct(lost)}%</span> of your land`); }
          break;
        }
        case 'elim': {
          const how = { cut: 'cut', enclosed: 'enclosed', zone: 'burned' }[e.cause];
          if (e.by >= 0) feed(`${tag(P[e.by])} ${how} ${tag(who)} <span class="up">+${pct(e.taken)}%</span>`);
          else feed(`${tag(who)} ${how} in the zone <span class="down">-${pct(e.lost)}%</span>`);
          if (e.by >= 0 && e.streak >= 2) feed(`${tag(P[e.by])} <b style="color:#ffd24f">${e.streak >= 4 ? 'RAMPAGE' : e.streak === 3 ? 'TRIPLE KO' : 'DOUBLE KO'}</b>`);
          if (e.revenge) feed(`${tag(P[e.by])} got <b style="color:#ff4fa3">REVENGE</b> on ${tag(who)}`);
          if (mine) { snd('koYou', at); st.deaths++; S.hitstop = 0.09; }
          else if (e.by === HUMAN) {
            snd(e.streak >= 2 ? 'streak' : e.revenge ? 'revenge' : 'ko', at);
            st.kills++; st.streak = Math.max(st.streak, e.streak); tu.kills++;
            if (e.revenge) st.revenges++;
            if (e.bounty) st.bounties++;
            S.hitstop = 0.09;
          } else snd('koOther', at);
          break;
        }
        case 'trap':
          feed(`${tag(P[e.by])} trapped ${tag(who)} <span class="down">-${pct(e.lost)}%</span>`);
          if (mine || e.by === HUMAN) snd('trap', at);
          if (e.by === HUMAN) { st.traps++; if (e.bounty) st.bounties++; S.hitstop = 0.07; }
          break;
        case 'orb':
          if (mine) { snd(e.kind === 'surge' ? 'surge' : 'orb', at); st.orbs++; tu.orbs++; }
          break;
        case 'crown':
          feed(`${tag(who)} takes the <b style="color:#ffd24f">CROWN</b>`);
          if (mine) snd('crown'); else if (e.from === HUMAN) snd('crownLost');
          break;
        case 'ability':
          if (e.kind === 'freeze' && e.target >= 0) feed(`${tag(who)} used FREEZE on ${tag(P[e.target])}`);
          else feed(`${tag(who)} used ${e.kind.toUpperCase()}`);
          if (mine) { snd(e.kind, at); anim(abilChips[e.kind], 'fire'); tu.abilities++; }
          else if (e.target === HUMAN) snd('frozen', at);
          break;
        case 'bump': if (mine) snd('bump', at); break;
        case 'zone': snd('zone'); break;
        case 'sudden': feed('<b class="down">SUDDEN DEATH - no more respawns</b>'); snd('sudden'); break;
        case 'close':
          feed(`<b style="color:#ffd24f">${mine ? 'YOU are' : who.name + ' is'} close to ${cfg.winPercent}%!</b>`);
          snd('close', { mine });
          break;
      }
    }
    R.fxEvents(m, m.events, { humanId: HUMAN });
    m.events.length = 0;
  }

  // ---------- flow ----------
  function setMode(mo) { S.mode = mo; S.modeT = 0; document.body.dataset.mode = mo; }
  function toMenu() { UI.renderMenu(); UI.show('menu'); UI.hint(null); setMode('menu'); }

  function newMatch(tutorial = false) {
    const bp = tutorial ? { aggrMul: 0.3, skill: 0.25 } : PF.botParams();
    const mcfg = {
      ...cfg,
      players: cfg.players.map((p, i) => (i === HUMAN ? { ...p, skin: { ...PF.data.selected } } : { ...p, aggr: Math.min(1, p.aggr * bp.aggrMul), skill: bp.skill })),
    };
    S.m = GC.createMatch(mcfg, (Math.random() * 2 ** 31) | 0);
    S.tutorial = tutorial;
    if (tutorial) { const y = S.m.players[HUMAN]; GC.addOrb(S.m, y.x + 8, y.y - 6, 'energy'); }
    S.stats = { kills: 0, traps: 0, orbs: 0, bigClaim: 0, streak: 0, revenges: 0, closeCalls: 0, bounties: 0, deaths: 0 };
    S.tut = { drew: false, claims: 0, orbs: 0, kills: 0, abilities: 0, step: 0, stepT: 0 };
    S.danger = 0; S.hitstop = 0; S.resultsShown = false;
    feedEl.innerHTML = '';
    buildHud(S.m);
    UI.show(null);
    UI.hint(tutorial ? TUT[0].text : null);
    setMode('countdown');
  }

  function endMatch() {
    const m = S.m, you = m.players[HUMAN], place = m.ranking.indexOf(you), lead = m.ranking[0];
    S.report = PF.applyMatch({ ...S.stats, place, win: place === 0, reason: m.endReason, pct: you.pct }, { ranked: !S.tutorial, tutorial: S.tutorial });
    let near = null;
    if (place > 0) {
      const gap = m.endReason === 'domination' ? cfg.winPercent - you.pct : lead.pct - you.pct;
      near = m.endReason === 'lastStanding' && !you.alive ? `Knocked out in sudden death - ${lead.name} survived`
        : gap < 5 ? `So close! You were ${gap.toFixed(1)}% from winning` : `You were ${gap.toFixed(1)}% from winning`;
    }
    S.resultInfo = {
      why: { domination: `${lead.id === HUMAN ? 'You' : lead.name} reached ${cfg.winPercent}% of the arena`, lastStanding: 'Last one standing', time: 'Biggest land when time ran out' }[m.endReason],
      near,
    };
    snd(place === 0 ? 'win' : 'lose');
    A.setMusic(null); A.setDanger(0);
    UI.hint(null);
    setMode('results');
  }

  UI.onAct = (act, dir) => {
    const [k, v] = act.split(':');
    if (k === 'play') newMatch(!PF.data.tutorialDone);
    else if (k === 'tutorial') newMatch(true);
    else if (k === 'rematch') newMatch(false);
    else if (k === 'menu') toMenu();
    else if (k === 'howto') { S.back = S.mode; UI.show(null); GC.howto.open(); setMode('howto'); }
    else if (k === 'settings') { UI.renderSettings(); UI.show('settings'); setMode('settings'); }
    else if (k === 'collection') { UI.renderCollection(); UI.show('collection'); setMode('collection'); }
    else if (k === 'ship' || k === 'trail') UI.equip(k, v);
    else { UI.adjustSetting(k, dir); applySettings(); }
  };

  // a bots-only match plays behind the menu
  const attractCfg = { ...cfg, players: cfg.players.map((p, i) => ({ ...p, isBot: true, aggr: p.aggr || 0.6, name: i === 0 ? 'NOVA' : p.name })) };
  function stepAttract(dt) {
    if (!S.attract || S.attract.over) S.attract = GC.createMatch(attractCfg, (Math.random() * 2 ** 31) | 0);
    const a = S.attract;
    GC.step(a, dt, p => GC.botThink(p, a));
    R.fxEvents(a, a.events, { quiet: true });
    a.events.length = 0;
  }

  function uiNav() {
    for (const d of ['up', 'down', 'left', 'right']) if (I.pressed(d)) UI.nav(d);
    if (I.pressed('confirm')) UI.confirm();
  }

  function musicLevel(m) { return m.suddenDeath ? 3 : m.time >= cfg.zone.start ? 2 : 1; }

  let lastCount = -1;
  function update(dt) {
    S.modeT += dt;
    if (I.pressed('mute')) A.toggleMute();
    for (const a of ABILITIES) if (I.pressed(a)) pendingAbility = a;
    switch (S.mode) {
      case 'menu':
        A.setMusic(0);
        stepAttract(dt); uiNav();
        if (S.mode !== 'menu') break;
        if (I.pressed('tutorial')) UI.onAct('tutorial');
        else if (I.pressed('help')) UI.onAct('howto');
        else if (I.pressed('collection')) UI.onAct('collection');
        else if (I.pressed('settings')) UI.onAct('settings');
        break;
      case 'settings':
      case 'collection':
        stepAttract(dt); uiNav();
        if (MENU_MODES.has(S.mode) && I.pressed('back')) toMenu();
        break;
      case 'howto':
        if (S.back === 'menu') stepAttract(dt);
        GC.howto.update(dt);
        if (I.pressed('help') || I.pressed('back') || I.pressed('confirm')) {
          GC.howto.close();
          if (S.back === 'menu') toMenu(); else S.mode = S.back;
        }
        break;
      case 'countdown': {
        A.setMusic(1);
        const c = 3 - Math.floor(S.modeT);
        if (c !== lastCount && c > 0) { lastCount = c; snd('tick'); }
        if (S.modeT >= 3) { lastCount = -1; snd('go'); setMode('play'); R.announce('GO!', '', '#9ff', 0.9); }
        break;
      }
      case 'paused':
        A.setDanger(0);
        if (I.pressed('pause')) S.mode = 'play';
        else if (I.pressed('help')) { S.back = 'paused'; GC.howto.open(); S.mode = 'howto'; }
        else if (I.pressed('quit')) toMenu();
        break;
      case 'results':
        if (!S.resultsShown && S.modeT >= 1.3) { S.resultsShown = true; UI.renderResults(S.m, HUMAN, S.report, S.resultInfo); }
        if (S.modeT > 3) A.setMusic(0);
        if (S.resultsShown) { uiNav(); if (S.mode === 'results' && I.pressed('back')) toMenu(); }
        break;
      case 'play': {
        if (I.pressed('pause')) { S.mode = 'paused'; break; }
        if (DEBUG && I.pressed('skip')) S.m.time = Math.max(S.m.time, S.m.duration - 1);
        if (S.hitstop > 0) { S.hitstop -= dt; break; } // a short freeze makes knockouts hit harder
        const m = S.m;
        GC.step(m, dt, inputFn);
        pendingAbility = null;
        handleEvents(m);
        stepTutorial(dt);
        A.setMusic(musicLevel(m));
        // danger: a rival close to your open line, or a very long line
        const you = m.players[HUMAN];
        let dg = 0;
        if (you.alive && you.drawing) dg = Math.max(clamp01((16 - GC.threatDist(m, you)) / 13), clamp01((you.trailCells.length - 50) / 150) * 0.5);
        S.danger += (dg - S.danger) * 0.15;
        if (S.danger < 0.01) S.danger = 0;
        A.setDanger(S.danger);
        if (m.over) endMatch();
        break;
      }
    }
    if (S.mode !== 'paused' && S.mode !== 'howto' && !(S.mode === 'play' && S.hitstop > 0)) R.update(dt);
    if (S.mode !== 'play') pendingAbility = null;
    I.endFrame();
  }

  function render() {
    if (S.mode === 'howto') GC.howto.render();
    if (MENU_MODES.has(S.mode) || (S.mode === 'howto' && S.back === 'menu')) {
      R.setPreview(null, null); R.setDanger(0);
      R.draw(S.attract);
      return R.drawTitle();
    }
    const m = S.m, you = m.players[HUMAN];
    R.setDanger(S.mode === 'play' ? S.danger : 0);
    R.setPreview(previewMask, S.mode === 'play' ? GC.previewClaim(m, you, previewMask) : null);
    R.draw(m, HUMAN);
    if (S.mode === 'countdown') R.countdown(S.modeT);
    if (S.mode === 'paused') R.banner('PAUSED', 'P / Esc continue  -  H how to play  -  Q quit to menu');
    if (S.mode === 'play' && !you.alive) {
      R.banner(you.out ? 'ELIMINATED' : `RESPAWN IN ${Math.ceil(you.respawnT)}`,
        you.out ? 'Sudden death - spectating' : `You come back with ${cfg.respawnEnergy} energy and a short shield`);
    }
  }

  // ---------- HUD (persistent elements so numbers can tween and rows can slide) ----------
  let rows = [], abilChips = {}, lastLead = -1, lastEnergy = 0, lastSec = -1, prevFrame = performance.now();
  function buildHud(m) {
    boardEl.innerHTML = '';
    rows = m.players.map(p => {
      const el = document.createElement('div');
      el.className = 'row';
      el.innerHTML = `<i style="background:${css(p.color)}"></i><b class="nm">${p.name}</b><u class="cr" title="Crown: the leader. Taking them down pays a bounty"></u><span class="pct">0.0%</span><em>KO 0</em><div class="prog"><div style="background:${css(p.color)}"></div></div>`;
      boardEl.appendChild(el);
      return { el, pctEl: el.querySelector('.pct'), koEl: el.querySelector('em'), crEl: el.querySelector('.cr'), bar: el.querySelector('.prog > div'), shown: p.pct, cells: p.cells, kills: 0, rank: -1, alive: true, pend: 0, pendT: 0, crown: false };
    });
    abilEl.innerHTML = '';
    abilChips = {};
    for (const [k, a] of Object.entries(cfg.abilities)) {
      const el = document.createElement('span');
      el.className = 'ab'; el.innerHTML = `${{ dash: 'Z', shield: 'X', freeze: 'C' }[k]} ${k.toUpperCase()} ${a.cost}`;
      el.dataset.ready = '0';
      abilEl.appendChild(el); abilChips[k] = el;
    }
    lastLead = -1; lastEnergy = 0; lastSec = -1;
  }

  function updateHud() {
    const now = performance.now(), dt = Math.min(0.1, (now - prevFrame) / 1000);
    prevFrame = now;
    const m = S.m;
    if (!m || !rows.length) return;
    const left = Math.max(0, m.duration - m.time), sec = Math.ceil(left);
    timeEl.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    const urgent = m.suddenDeath || left <= 10;
    timeEl.classList.toggle('urgent', urgent);
    if (urgent && sec !== lastSec && S.mode === 'play') anim(timeEl, 'tick');
    lastSec = sec;
    phaseEl.innerHTML = m.suddenDeath ? '<span class="sd">SUDDEN DEATH</span>' : m.time >= cfg.zone.start ? '<span class="zn">ZONE SHRINKING</span>' : `zone in ${Math.ceil(cfg.zone.start - m.time)}s`;

    const sorted = [...m.players].sort((a, b) => b.cells - a.cells), lead = sorted[0];
    leadEl.textContent = `${lead.id === HUMAN ? 'YOU lead' : lead.name + ' leads'} - needs ${Math.max(0, cfg.winPercent - lead.pct).toFixed(1)}% more`;
    if (lead.id !== lastLead) { if (lastLead >= 0) anim(leadEl, 'flash'); lastLead = lead.id; }

    sorted.forEach((p, rank) => {
      const r = rows[p.id];
      // gather land changes for a moment, then pop a +/- chip
      const dCells = p.cells - r.cells; r.cells = p.cells;
      if (dCells !== 0) { r.pend += dCells / m.aliveCells * 100; r.pendT = 0.25; }
      if (r.pendT > 0 && (r.pendT -= dt) <= 0) {
        if (Math.abs(r.pend) >= 0.2) {
          floatChip(r.el, `${r.pend > 0 ? '+' : ''}${r.pend.toFixed(1)}%`, r.pend > 0 ? 'up' : 'down');
          anim(r.el, r.pend > 0 ? 'gain' : 'loss');
        }
        r.pend = 0;
      }
      r.shown += (p.pct - r.shown) * Math.min(1, dt * 7); // numbers count toward the real value
      if (Math.abs(p.pct - r.shown) < 0.05) r.shown = p.pct;
      r.pctEl.textContent = r.shown.toFixed(1) + '%';
      r.bar.style.width = Math.min(100, r.shown / cfg.winPercent * 100) + '%';
      if (p.kills !== r.kills) { r.kills = p.kills; r.koEl.textContent = 'KO ' + p.kills; anim(r.koEl, 'pop'); }
      if (rank !== r.rank) { if (r.rank >= 0 && rank < r.rank) anim(r.el, 'rankup'); r.rank = rank; r.el.style.left = `calc(${rank * 25}% + ${rank * 1.5}px)`; }
      if (p.alive !== r.alive) { r.alive = p.alive; r.el.classList.toggle('dead', !p.alive); }
      const crowned = m.crown === p.id;
      if (crowned !== r.crown) { r.crown = crowned; r.crEl.classList.toggle('on', crowned); if (crowned) anim(r.crEl, 'pop'); }
      r.el.classList.toggle('near', p.pct >= cfg.winPercent * 0.8);
    });

    const you = m.players[HUMAN];
    energyEl.style.width = `${you.energy / cfg.energyMax * 100}%`;
    const gain = you.energy - lastEnergy;
    if (gain >= 1) { floatChip(energyWrap, `+${Math.round(gain)}`, 'up'); anim(energyWrap, 'charge'); }
    lastEnergy = you.energy;
    for (const [k, a] of Object.entries(cfg.abilities)) {
      const el = abilChips[k], ready = you.energy >= a.cost;
      if (ready !== (el.dataset.ready === '1')) { el.dataset.ready = ready ? '1' : '0'; el.classList.toggle('ready', ready); if (ready) anim(el, 'pop'); }
      el.classList.toggle('active', (k === 'dash' && you.dashT > 0) || (k === 'shield' && you.shieldT > 0));
    }
  }

  // ---------- loop ----------
  toMenu();
  const STEP = 1 / 60;
  let acc = 0, prev = performance.now();
  function frame(now) {
    acc += Math.min(0.1, (now - prev) / 1000); prev = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render(); updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (DEBUG) window.__step = n => { for (let i = 0; i < n; i++) update(STEP); render(); updateHud(); };
})();
