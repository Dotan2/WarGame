'use strict';
// Player profile kept in the browser: XP and levels, leagues against the bots, daily challenges,
// achievements, cosmetic unlocks and settings. Nothing here changes the match rules:
// leagues only tune the bots, and unlocks are looks only.
(() => {
  const GC = window.GC, KEY = 'gridclash.profile.v1';

  const LEAGUES = [
    { name: 'BRONZE', color: '#d08f55', aggr: 0.55, skill: 0.35 },
    { name: 'SILVER', color: '#c8d3e6', aggr: 0.75, skill: 0.55 },
    { name: 'GOLD', color: '#ffd24f', aggr: 0.95, skill: 0.75 },
    { name: 'PLATINUM', color: '#7ff0e0', aggr: 1.1, skill: 0.9 },
    { name: 'DIAMOND', color: '#b48cff', aggr: 1.25, skill: 1 },
  ];
  const LP_BY_PLACE = [35, 15, -10, -20];
  const DIFFICULTY = { auto: null, easy: 0, normal: 2, hard: 4 };

  const SHIPS = [
    { id: 'dart', name: 'Dart', level: 1 }, { id: 'arrow', name: 'Arrow', level: 3 }, { id: 'delta', name: 'Delta', level: 5 },
    { id: 'orb', name: 'Orb', level: 8 }, { id: 'star', name: 'Star', level: 12 },
  ];
  const TRAILS = [
    { id: 'solid', name: 'Solid', level: 1 }, { id: 'dotted', name: 'Dotted', level: 4 },
    { id: 'pulse', name: 'Pulse', level: 7 }, { id: 'rainbow', name: 'Rainbow', level: 10 },
  ];

  // stat: a key of the match stats; max: the best single match counts instead of a daily sum
  const CHALLENGES = [
    { id: 'ko', stat: 'kills', goals: [3, 5], text: n => `Knock out ${n} rivals` },
    { id: 'trap', stat: 'traps', goals: [1, 2], text: n => `Trap ${n} rival${n > 1 ? 's' : ''}` },
    { id: 'orbs', stat: 'orbs', goals: [6, 10], text: n => `Collect ${n} energy cells` },
    { id: 'big', stat: 'bigClaim', max: true, goals: [4, 6], text: n => `Claim ${n}% or more in one loop` },
    { id: 'win', stat: 'wins', goals: [1, 2], text: n => `Win ${n} match${n > 1 ? 'es' : ''}` },
    { id: 'pct', stat: 'pct', max: true, goals: [25, 35], text: n => `Finish a match with ${n}% land` },
    { id: 'streak', stat: 'streak', max: true, goals: [2], text: () => 'Get a DOUBLE KO' },
    { id: 'revenge', stat: 'revenges', goals: [1, 2], text: n => `Get ${n} REVENGE knockout${n > 1 ? 's' : ''}` },
    { id: 'close', stat: 'closeCalls', goals: [2, 3], text: n => `Land ${n} CLOSE CALL claims` },
    { id: 'bounty', stat: 'bounties', goals: [1], text: () => 'Take down the CROWN holder' },
  ];

  const ACHIEVEMENTS = [
    { id: 'firstKo', name: 'First Blood', text: 'Knock out a rival', test: (s) => s.kills >= 1 },
    { id: 'firstWin', name: 'Conqueror', text: 'Win a match', test: s => s.win },
    { id: 'landlord', name: 'Landlord', text: 'Win by reaching the target %', test: s => s.win && s.reason === 'domination' },
    { id: 'untouchable', name: 'Untouchable', text: 'Win without being knocked out', test: s => s.win && s.deaths === 0 },
    { id: 'rampage', name: 'Rampage', text: '3 knockouts in a streak', test: s => s.streak >= 3 },
    { id: 'trapper', name: 'Trapper', text: 'Trap 10 rivals in total', test: (s, t) => t.traps >= 10 },
    { id: 'veteran', name: 'Veteran', text: 'Play 25 matches', test: (s, t) => t.matches >= 25 },
    { id: 'diamond', name: 'Diamond Mind', text: 'Reach the Diamond league', test: (s, t, d) => d.league >= 4 },
  ];

  const need = level => 120 + (level - 1) * 40; // XP to finish a level
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const hash = str => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

  const fresh = () => ({
    xp: 0, level: 1, league: 0, lp: 20,
    totals: { matches: 0, wins: 0, kills: 0, traps: 0 },
    best: { pct: 0, kills: 0, claim: 0 },
    daily: null, achievements: {},
    selected: { ship: 'dart', trail: 'solid' },
    settings: { music: 0.6, sfx: 0.8, shake: true, difficulty: 'auto' },
    tutorialDone: false,
  });

  let data = fresh();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) data = { ...data, ...saved, settings: { ...data.settings, ...saved.settings }, selected: { ...data.selected, ...saved.selected } };
  } catch (_) { /* storage blocked: keep an in-memory profile */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* ignore */ } };

  function dailies() {
    const d = today();
    if (!data.daily || data.daily.date !== d) {
      const pool = CHALLENGES.map(c => c.id), list = [];
      let h = hash(d);
      while (list.length < 3) {
        const id = pool.splice(h % pool.length, 1)[0], c = CHALLENGES.find(x => x.id === id);
        list.push({ id, goal: c.goals[(h >>> 4) % c.goals.length], prog: 0, done: false });
        h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
      }
      data.daily = { date: d, list };
      save();
    }
    return data.daily.list.map(ch => ({ ...ch, text: CHALLENGES.find(c => c.id === ch.id).text(ch.goal) }));
  }

  function botParams() {
    const fixed = DIFFICULTY[data.settings.difficulty];
    const L = LEAGUES[fixed ?? data.league];
    return { aggrMul: L.aggr, skill: L.skill };
  }

  // stats: { place, win, reason, pct, kills, traps, orbs, bigClaim, streak, revenges, closeCalls, bounties, deaths }
  function applyMatch(s, opts = {}) {
    dailies();
    const r = { xpItems: [], levelBefore: data.level, xpBefore: data.xp, needBefore: need(data.level) };
    const add = (label, xp) => { if (xp > 0) r.xpItems.push({ label, xp: Math.round(xp) }); };
    add(['1st place', '2nd place', '3rd place', '4th place'][s.place], [100, 60, 40, 25][s.place]);
    add(`Land ${s.pct.toFixed(1)}%`, s.pct * 1.5);
    add(`${s.kills} knockout${s.kills > 1 ? 's' : ''}`, s.kills * 15);
    add(`${s.traps} trap${s.traps > 1 ? 's' : ''}`, s.traps * 20);
    add(`${s.orbs} energy cell${s.orbs > 1 ? 's' : ''}`, s.orbs * 3);
    add('Crown bounty', s.bounties * 25);
    add('Revenge', s.revenges * 15);

    // daily challenges
    r.challenges = data.daily.list.map(ch => {
      const c = CHALLENGES.find(x => x.id === ch.id), before = ch.prog;
      const v = c.stat === 'wins' ? (s.win ? 1 : 0) : s[c.stat] || 0;
      ch.prog = Math.min(ch.goal, c.max ? Math.max(ch.prog, v) : ch.prog + v);
      const justDone = !ch.done && ch.prog >= ch.goal;
      if (justDone) { ch.done = true; add(`Challenge: ${c.text(ch.goal)}`, 50); }
      return { text: c.text(ch.goal), before, prog: ch.prog, goal: ch.goal, done: ch.done, justDone };
    });

    // XP and levels
    r.xpTotal = r.xpItems.reduce((a, b) => a + b.xp, 0);
    data.xp += r.xpTotal;
    r.unlocks = [];
    while (data.xp >= need(data.level)) {
      data.xp -= need(data.level); data.level++;
      for (const c of [...SHIPS, ...TRAILS]) if (c.level === data.level) r.unlocks.push(c.name + (SHIPS.includes(c) ? ' ship' : ' trail'));
    }
    r.levelAfter = data.level; r.xpAfter = data.xp; r.needAfter = need(data.level);

    // league points (the tutorial match does not count)
    r.leagueBefore = data.league; r.lpBefore = data.lp;
    if (opts.ranked !== false) {
      data.lp += LP_BY_PLACE[s.place];
      if (data.lp >= 100 && data.league < LEAGUES.length - 1) { data.league++; data.lp = 20; r.promoted = true; }
      else if (data.lp < 0 && data.league > 0) { data.league--; data.lp = 70; r.demoted = true; }
      data.lp = Math.max(0, Math.min(100, data.lp));
    }
    r.leagueAfter = data.league; r.lpAfter = data.lp; r.lpDelta = opts.ranked === false ? 0 : LP_BY_PLACE[s.place];

    // totals, personal bests, achievements
    const t = data.totals;
    t.matches++; if (s.win) t.wins++; t.kills += s.kills; t.traps += s.traps;
    r.bests = [];
    if (s.pct > data.best.pct + 0.05) { data.best.pct = s.pct; r.bests.push(`Land ${s.pct.toFixed(1)}%`); }
    if (s.kills > data.best.kills) { data.best.kills = s.kills; r.bests.push(`${s.kills} knockouts`); }
    if (s.bigClaim > data.best.claim + 0.05) { data.best.claim = s.bigClaim; r.bests.push(`Biggest claim ${s.bigClaim.toFixed(1)}%`); }
    r.achievements = [];
    for (const a of ACHIEVEMENTS) if (!data.achievements[a.id] && a.test(s, t, data)) { data.achievements[a.id] = Date.now(); r.achievements.push(a); }
    if (opts.tutorial) data.tutorialDone = true;
    save();
    return r;
  }

  GC.profile = {
    LEAGUES, SHIPS, TRAILS, ACHIEVEMENTS, need,
    get data() { return data; },
    dailies, botParams, applyMatch, save,
    league: () => LEAGUES[data.league],
    unlocked: c => data.level >= c.level,
    reset() { const settings = data.settings; data = fresh(); data.settings = settings; save(); },
  };
})();
