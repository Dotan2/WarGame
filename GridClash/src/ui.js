'use strict';
// DOM screens over the arena: main menu, settings, collection, results, toasts and tutorial hints.
// Keyboard: arrows move the focus, Enter activates. Mouse works too. Actions go to GC.ui.onAct.
(() => {
  const GC = window.GC, PF = GC.profile, cfg = window.GC_CONFIG;
  const $ = id => document.getElementById(id);
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const panels = { menu: $('menu'), settings: $('settings'), collection: $('collection'), results: $('results') };
  let current = null, focus = 0, timers = [];
  const snd = n => GC.audio.play(n);

  const ui = {
    onAct: () => {},
    get current() { return current; },
  };

  function buttons() { return current ? [...panels[current].querySelectorAll('.btn')] : []; }
  function setFocus(i, quiet) {
    const b = buttons();
    if (!b.length) return;
    focus = (i + b.length) % b.length;
    b.forEach((el, k) => el.classList.toggle('focus', k === focus));
    b[focus].scrollIntoView({ block: 'nearest' });
    if (!quiet) snd('ui');
  }
  function wire(panel) {
    panel.querySelectorAll('.btn').forEach((el, k) => {
      el.addEventListener('mouseenter', () => { if (k !== focus) setFocus(k, true); });
      el.addEventListener('click', () => { setFocus(k, true); activate(); });
    });
  }
  function activate() {
    const el = buttons()[focus];
    if (!el || el.classList.contains('locked')) return;
    snd('uiOk');
    ui.onAct(el.dataset.act, 1);
  }

  ui.show = (name, startFocus = 0) => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    for (const k in panels) panels[k].classList.toggle('open', k === name);
    current = name;
    if (name) setFocus(startFocus, true);
  };
  ui.nav = dir => {
    if (current === 'settings' && (dir === 'left' || dir === 'right')) {
      const el = buttons()[focus];
      if (el && el.dataset.adj) ui.onAct(el.dataset.act, dir === 'left' ? -1 : 1);
      return;
    }
    setFocus(focus + (dir === 'up' || dir === 'left' ? -1 : 1));
  };
  ui.confirm = activate;

  // ---------- menu ----------
  const bar = (v, color) => `<div class="mbar"><div style="width:${Math.max(0, Math.min(100, v * 100))}%;${color ? 'background:' + color : ''}"></div></div>`;
  ui.renderMenu = () => {
    const d = PF.data, L = PF.league(), need = PF.need(d.level);
    const ch = PF.dailies();
    panels.menu.innerHTML = `
      <div class="logo">TERRITORY WAR<small>GRID CLASH</small></div>
      <div class="goal">FIRST TO ${cfg.winPercent}% OF THE ARENA WINS</div>
      <div class="mcols">
        <div class="card">
          <div class="lvl">LEVEL <b>${d.level}</b><span>${d.xp} / ${need} XP</span></div>${bar(d.xp / need)}
          <div class="lvl league" style="color:${L.color}">${L.name} LEAGUE<span>${d.lp} / 100 LP</span></div>${bar(d.lp / 100, L.color)}
          <div class="sub">1st +35 LP, 2nd +15, 3rd -10, 4th -20. Higher leagues have sharper bots.</div>
          <div class="sub">Wins <b>${d.totals.wins}</b> &middot; Matches <b>${d.totals.matches}</b> &middot; Best land <b>${d.best.pct.toFixed(1)}%</b></div>
        </div>
        <div class="card">
          <h4>DAILY CHALLENGES <span>+50 XP each</span></h4>
          ${ch.map(c => `<div class="chal ${c.done ? 'done' : ''}"><div>${c.text}<span>${c.done ? 'DONE' : c.prog.toFixed(c.prog % 1 ? 1 : 0) + ' / ' + c.goal}</span></div>${bar(c.prog / c.goal, c.done ? '#5dff9e' : '')}</div>`).join('')}
          <div class="sub">New challenges every day.</div>
        </div>
      </div>
      <div class="btns">
        <div class="btn big" data-act="play">${d.tutorialDone ? 'PLAY' : 'PLAY - FIRST MATCH IS GUIDED'}<kbd>Enter</kbd></div>
        <div class="row4">
          <div class="btn" data-act="tutorial">TUTORIAL<kbd>T</kbd></div>
          <div class="btn" data-act="howto">HOW TO PLAY<kbd>H</kbd></div>
          <div class="btn" data-act="collection">COLLECTION<kbd>K</kbd></div>
          <div class="btn" data-act="settings">SETTINGS<kbd>O</kbd></div>
        </div>
      </div>
      <div class="keys">Arrows choose &middot; Enter select &middot; M mute</div>`;
    wire(panels.menu);
  };

  // ---------- settings ----------
  const DIFF = ['auto', 'easy', 'normal', 'hard'];
  let resetArmed = false;
  ui.renderSettings = () => {
    const s = PF.data.settings;
    const vol = v => `<span class="vol">${'<i class="on"></i>'.repeat(Math.round(v * 10))}${'<i></i>'.repeat(10 - Math.round(v * 10))}</span>`;
    panels.settings.innerHTML = `
      <h2>SETTINGS</h2>
      <div class="btn set" data-act="music" data-adj="1">Music${vol(s.music)}</div>
      <div class="btn set" data-act="sfx" data-adj="1">Effects${vol(s.sfx)}</div>
      <div class="btn set" data-act="shake" data-adj="1">Screen shake<b>${s.shake ? 'ON' : 'OFF'}</b></div>
      <div class="btn set" data-act="difficulty" data-adj="1">Bot difficulty<b>${s.difficulty === 'auto' ? 'AUTO (by league)' : s.difficulty.toUpperCase()}</b></div>
      <div class="btn set danger" data-act="reset">${resetArmed ? 'Press again to erase all progress' : 'Reset progress'}<b>XP, league, unlocks</b></div>
      <div class="btn set" data-act="menu">Back<b>Esc</b></div>
      <div class="keys">Left / Right change a value</div>`;
    wire(panels.settings);
  };
  ui.adjustSetting = (key, dir) => {
    const s = PF.data.settings;
    if (key === 'music' || key === 'sfx') s[key] = Math.round(Math.max(0, Math.min(1, s[key] + dir * 0.1)) * 10) / 10;
    else if (key === 'shake') s.shake = !s.shake;
    else if (key === 'difficulty') s.difficulty = DIFF[(DIFF.indexOf(s.difficulty) + dir + DIFF.length) % DIFF.length];
    else if (key === 'reset') { if (resetArmed) { PF.reset(); resetArmed = false; ui.toast('PROGRESS RESET', 'starting fresh', '#ff6b6b'); } else resetArmed = true; }
    if (key !== 'reset') resetArmed = false;
    PF.save();
    const f = focus;
    ui.renderSettings(); setFocus(f, true);
  };

  // ---------- collection (cosmetics only) ----------
  function shipIcon(shape, color) {
    const c = document.createElement('canvas'); c.width = 44; c.height = 44;
    const g = c.getContext('2d');
    g.translate(22, 22); g.scale(2, 2); g.rotate(-Math.PI / 4);
    GC.drawShip(g, shape, color, '#fff');
    return c.toDataURL();
  }
  function trailIcon(kind, col) {
    const c = document.createElement('canvas'); c.width = 70; c.height = 14;
    const g = c.getContext('2d');
    for (let x = 0; x < 14; x++) {
      let r = col[0] + 70, gg = col[1] + 70, b = col[2] + 70, k = 1;
      if (kind === 'rainbow') { g.fillStyle = `hsl(${x * 26},100%,62%)`; g.fillRect(x * 5, 4, 5, 6); continue; }
      if (kind === 'dotted') k = x & 1 ? 0.55 : 1;
      if (kind === 'pulse') k = 0.7 + 0.3 * Math.sin(x * 0.9);
      g.fillStyle = `rgb(${Math.min(255, r * k)},${Math.min(255, gg * k)},${Math.min(255, b * k)})`; g.fillRect(x * 5, 4, 5, 6);
    }
    return c.toDataURL();
  }
  ui.renderCollection = () => {
    const d = PF.data, col = cfg.players[0].color;
    const item = (c, kind, icon) => {
      const open = PF.unlocked(c), sel = d.selected[kind] === c.id;
      return `<div class="btn item ${open ? '' : 'locked'} ${sel ? 'sel' : ''}" data-act="${kind}:${c.id}"><img src="${icon}" alt=""><span>${c.name}</span><em>${open ? (sel ? 'EQUIPPED' : 'Enter to equip') : 'LEVEL ' + c.level}</em></div>`;
    };
    panels.collection.innerHTML = `
      <h2>COLLECTION <span>Level ${d.level} &middot; looks only, no gameplay advantage</span></h2>
      <h4>SHIPS</h4><div class="items">${PF.SHIPS.map(c => item(c, 'ship', shipIcon(c.id, css(col)))).join('')}</div>
      <h4>TRAILS</h4><div class="items">${PF.TRAILS.map(c => item(c, 'trail', trailIcon(c.id, col))).join('')}</div>
      <h4>ACHIEVEMENTS</h4><div class="ach">${PF.ACHIEVEMENTS.map(a => `<div class="${d.achievements[a.id] ? 'got' : ''}"><b>${a.name}</b>${a.text}</div>`).join('')}</div>
      <div class="btn set" data-act="menu">Back<b>Esc</b></div>`;
    wire(panels.collection);
  };
  ui.equip = (kind, id) => {
    PF.data.selected[kind] = id; PF.save();
    const f = focus; ui.renderCollection(); setFocus(f, true);
  };

  // ---------- results ----------
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  function tween(ms, fn, done) { // fn(u) for u 0..1 on animation frames
    const t0 = performance.now();
    const go = now => { const u = Math.min(1, (now - t0) / ms); fn(u); if (u < 1) requestAnimationFrame(go); else if (done) done(); };
    requestAnimationFrame(go);
  }
  ui.renderResults = (m, hid, rep, info) => {
    const you = m.players[hid], place = m.ranking.indexOf(you), L0 = PF.LEAGUES[rep.leagueBefore], L1 = PF.LEAGUES[rep.leagueAfter];
    const title = place === 0 ? 'YOU WIN!' : ['', '2ND PLACE', '3RD PLACE', '4TH PLACE'][place];
    panels.results.innerHTML = `
      <div class="rhead ${place === 0 ? 'win' : ''}">${title}</div>
      <div class="why">${info.why}</div>
      ${info.near ? `<div class="near">${info.near}</div>` : ''}
      <div class="rcols">
        <div class="card"><h4>STANDINGS</h4>
          ${m.ranking.map((p, i) => `<div class="rk ${p.id === hid ? 'me' : ''}" style="animation-delay:${0.15 + i * 0.12}s"><i style="background:${css(p.color)}"></i><b>${i + 1}. ${p.name}</b><span data-pct="${p.pct}">0.0%</span><em>KO ${p.kills}</em></div>`).join('')}
          ${rep.bests.length ? `<div class="best">NEW PERSONAL BEST: ${rep.bests.join(', ')}</div>` : ''}
        </div>
        <div class="card"><h4>XP <span id="rXp">+0</span></h4>
          <div class="xpi">${rep.xpItems.map((it, i) => `<div style="animation-delay:${0.5 + i * 0.1}s">${it.label}<span>+${it.xp}</span></div>`).join('')}</div>
          <div class="lvl">LEVEL <b id="rLvl">${rep.levelBefore}</b><span id="rXpTxt"></span></div>${bar(rep.xpBefore / rep.needBefore)}
          <div class="lvl league" id="rLg" style="color:${L0.color}">${L0.name}<span>${rep.lpDelta ? (rep.lpDelta > 0 ? '+' : '') + rep.lpDelta + ' LP' : 'Tutorial: no LP'}</span></div>${bar(rep.lpBefore / 100, L0.color)}
        </div>
      </div>
      <div class="card chals"><h4>DAILY CHALLENGES</h4>
        ${rep.challenges.map(c => `<div class="chal ${c.done && !c.justDone ? 'done' : ''}"><div>${c.text}<span>${c.prog.toFixed(c.prog % 1 ? 1 : 0)} / ${c.goal}</span></div>${bar(c.before / c.goal, c.done && !c.justDone ? '#5dff9e' : '')}</div>`).join('')}
      </div>
      <div class="btns"><div class="row2"><div class="btn big" data-act="rematch">REMATCH<kbd>Enter</kbd></div><div class="btn big" data-act="menu">MENU<kbd>Esc</kbd></div></div></div>`;
    wire(panels.results);
    ui.show('results');

    const pctEls = panels.results.querySelectorAll('.rk span');
    tween(900, u => pctEls.forEach(el => { el.textContent = (el.dataset.pct * (1 - Math.pow(1 - u, 3))).toFixed(1) + '%'; }));

    // XP bar: fill, roll over on level-ups, settle on the new value
    const [xpBar, lpBar] = panels.results.querySelectorAll('.rcols .card:nth-child(2) .mbar > div');
    const xpNum = $('rXp'), lvlEl = $('rLvl'), xpTxt = $('rXpTxt');
    const levels = rep.levelAfter - rep.levelBefore;
    later(900, () => {
      let lvl = rep.levelBefore, from = rep.xpBefore / rep.needBefore;
      const seg = () => {
        const last = lvl === rep.levelAfter, to = last ? rep.xpAfter / rep.needAfter : 1;
        tween(last ? 700 : 500, u => {
          xpBar.style.width = (from + (to - from) * u) * 100 + '%';
          if (Math.random() < 0.3) GC.audio.play('xp', { p: u });
        }, () => {
          if (last) return;
          lvl++; from = 0; lvlEl.textContent = lvl; snd('levelup');
          lvlEl.parentElement.classList.remove('lvup'); void lvlEl.offsetWidth; lvlEl.parentElement.classList.add('lvup');
          ui.toast(`LEVEL ${lvl}!`, rep.unlocks.length ? 'Unlocked: ' + rep.unlocks.join(', ') : 'keep going', '#4fd1ff');
          seg();
        });
      };
      seg();
      tween(900, u => { xpNum.textContent = '+' + Math.round(rep.xpTotal * u); });
      xpTxt.textContent = `${rep.xpAfter} / ${rep.needAfter} XP`;
    });
    // league points
    later(1500 + levels * 500, () => {
      if (rep.promoted || rep.demoted) {
        tween(500, u => { lpBar.style.width = (rep.lpBefore + ((rep.promoted ? 100 : 0) - rep.lpBefore) * u) + '%'; }, () => {
          const lg = $('rLg');
          lg.style.color = L1.color; lg.firstChild.textContent = L1.name; lpBar.style.background = L1.color;
          lg.classList.add('lvup');
          if (rep.promoted) { snd('levelup'); ui.toast(`PROMOTED TO ${L1.name}!`, 'the bots get sharper', L1.color); } else ui.toast(`DOWN TO ${L1.name}`, 'win it back', '#ff9d3c');
          tween(400, u => { lpBar.style.width = ((rep.promoted ? 0 : 100) + (rep.lpAfter - (rep.promoted ? 0 : 100)) * u) + '%'; });
        });
      } else tween(600, u => { lpBar.style.width = (rep.lpBefore + (rep.lpAfter - rep.lpBefore) * u) + '%'; });
    });
    // challenges and achievements
    later(1900 + levels * 500, () => {
      const rows = panels.results.querySelectorAll('.chals .chal');
      rep.challenges.forEach((c, i) => {
        const b = rows[i].querySelector('.mbar > div');
        tween(500, u => { b.style.width = (c.before + (c.prog - c.before) * u) / c.goal * 100 + '%'; }, () => {
          if (c.justDone) { rows[i].classList.add('done', 'stamp'); b.style.background = '#5dff9e'; snd('achieve'); }
        });
      });
      rep.achievements.forEach((a, i) => later(600 + i * 900, () => { snd('achieve'); ui.toast('ACHIEVEMENT: ' + a.name, a.text, '#ffd24f'); }));
    });
  };

  // ---------- toasts and hints ----------
  ui.toast = (title, sub, color = '#fff') => {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<b style="color:${color}">${title}</b><span>${sub || ''}</span>`;
    $('toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3300);
  };
  let hintHtml = null;
  ui.hint = html => {
    const el = $('hint');
    if (html === hintHtml) return;
    hintHtml = html;
    el.classList.toggle('open', !!html);
    if (html) { el.innerHTML = html; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  };

  GC.ui = ui;
})();
