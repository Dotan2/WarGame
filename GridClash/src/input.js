'use strict';
// Input abstraction: physical keys map to actions, and the game only reads actions.
// Touch controls or a network client can later feed the same actions through press/release.
(() => {
  const GC = window.GC = window.GC || {};
  // e.code is layout independent, so a Hebrew keyboard works too
  const BINDINGS = {
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    cut: ['Space'], dash: ['KeyZ'], shield: ['KeyX'], freeze: ['KeyC'],
    confirm: ['Enter'], back: ['Escape'], pause: ['KeyP', 'Escape'], help: ['KeyH'], mute: ['KeyM'],
    settings: ['KeyO'], collection: ['KeyK'], tutorial: ['KeyT'], quit: ['KeyQ'], skip: ['KeyN'],
  };
  const DIRS = ['up', 'down', 'left', 'right'];
  const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  const byCode = {};
  for (const [a, codes] of Object.entries(BINDINGS)) for (const c of codes) (byCode[c] = byCode[c] || []).push(a);

  const heldCodes = new Set(), held = new Set(), pressed = new Set(), dirStack = [];
  const listeners = [];
  function press(a) {
    if (!held.has(a)) pressed.add(a);
    held.add(a);
    if (DIRS.includes(a)) { const i = dirStack.indexOf(a); if (i >= 0) dirStack.splice(i, 1); dirStack.push(a); }
  }
  function release(a) {
    held.delete(a);
    const i = dirStack.indexOf(a); if (i >= 0) dirStack.splice(i, 1);
  }
  addEventListener('keydown', e => {
    if (BLOCK.has(e.code)) e.preventDefault();
    for (const f of listeners) f(e);
    if (heldCodes.has(e.code)) return;
    heldCodes.add(e.code);
    for (const a of byCode[e.code] || []) press(a);
  });
  addEventListener('keyup', e => {
    heldCodes.delete(e.code);
    for (const a of byCode[e.code] || []) if (!BINDINGS[a].some(c => heldCodes.has(c))) release(a);
  });
  addEventListener('blur', () => { heldCodes.clear(); held.clear(); dirStack.length = 0; });

  GC.input = {
    BINDINGS,
    held: a => held.has(a),
    pressed: a => pressed.has(a),
    dir: () => dirStack[dirStack.length - 1] || null,
    endFrame: () => pressed.clear(),
    press, release,
    onKey: f => listeners.push(f), // raw keydown hook (audio unlock, menus)
  };
})();
