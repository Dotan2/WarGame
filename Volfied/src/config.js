// All gameplay tunables live here so balance can change without touching game logic.
// Units: positions/speeds are in grid cells (and cells per second); times are in seconds.
window.VOLFIED_CONFIG = {
  gridW: 200,
  gridH: 150,
  cell: 4, // pixels per cell -> 800x600 playfield

  lives: 3,
  playerSpeed: 40,
  playerSpeedBoost: 66,
  retractSpeed: 55, // ship rewinding along its own line when the cut button is released
  playerR: 1.3,
  respawnInvuln: 2.0,

  // Shield: while it is above zero the ship is safe on the border ("shield line").
  // When it runs out, any contact is deadly even on the border. Resets every life / round.
  shieldMax: 99,
  shieldDrainPerSec: 1.25,

  // An enemy touching the line being cut sends a spark along it toward the ship.
  sparkSpeed: 60,

  laserSpeed: 130,
  laserCooldown: 0.14,

  pointsPerCell: 1,
  bigCutFraction: 0.15, // one cut claiming >= 15% of the field scores double
  minionKill: 500,
  percentBonus: 1000, // per whole percent above the round's target
  bossKillBonus: 30000,
  splitBonus: 15000,

  powerupDurations: { S: 12, T: 6, P: 15, L: 12 },
  // S speed, T time stop, P shield pause, L laser, C clear minions, B boss damage, 1UP extra life
  powerupWeights: { S: 20, T: 18, P: 16, L: 18, C: 12, B: 10, '1UP': 6 },

  levels: [
    { bosses: [{ type: 'bouncer', speed: 20, r: 7, hp: 20 }], minions: [{ type: 'bouncer', n: 2, speed: 18 }], boxes: 6 },
    { bosses: [{ type: 'bouncer', speed: 24, r: 7, hp: 22 }], minions: [{ type: 'bouncer', n: 2, speed: 20 }, { type: 'wander', n: 1, speed: 18 }], boxes: 6 },
    { bosses: [{ type: 'hunter', speed: 20, r: 7, hp: 24, dashEvery: 4, dashMul: 2.2 }], minions: [{ type: 'wander', n: 3, speed: 20 }], boxes: 6 },
    { bosses: [{ type: 'spawner', speed: 16, r: 8, hp: 26, spawnEvery: 5, spawnCap: 4, spawnType: 'wander' }], minions: [{ type: 'bouncer', n: 2, speed: 22 }], boxes: 6 },
    { bosses: [{ type: 'shooter', speed: 18, r: 7, hp: 26, fireEvery: 2.6, bulletSpeed: 32, spread: 1 }], minions: [{ type: 'bouncer', n: 3, speed: 22 }], boxes: 5 },
    { bosses: [{ type: 'hunter', speed: 24, r: 7, hp: 28, dashEvery: 3.5, dashMul: 2.4 }], minions: [{ type: 'chaser', n: 2, speed: 12 }, { type: 'bouncer', n: 2, speed: 24 }], boxes: 5 },
    { bosses: [{ type: 'spawner', speed: 20, r: 8, hp: 30, spawnEvery: 4, spawnCap: 6, spawnType: 'chaser' }], minions: [{ type: 'wander', n: 2, speed: 24 }], boxes: 5 },
    { bosses: [{ type: 'bouncer', speed: 22, r: 6, hp: 18 }, { type: 'bouncer', speed: 22, r: 6, hp: 18 }], minions: [{ type: 'bouncer', n: 2, speed: 22 }], boxes: 5 },
    { bosses: [{ type: 'shooter', speed: 20, r: 7, hp: 30, fireEvery: 2.4, bulletSpeed: 36, spread: 3 }], minions: [{ type: 'wander', n: 3, speed: 24 }], boxes: 5 },
    { bosses: [{ type: 'hunter', speed: 26, r: 7, hp: 32, dashEvery: 3, dashMul: 2.5 }], minions: [{ type: 'chaser', n: 3, speed: 14 }, { type: 'bouncer', n: 1, speed: 26 }], boxes: 5 },
    { bosses: [{ type: 'spawner', speed: 22, r: 8, hp: 32, spawnEvery: 3.5, spawnCap: 7, spawnType: 'bouncer' }], minions: [{ type: 'chaser', n: 2, speed: 14 }], boxes: 5 },
    { bosses: [{ type: 'shooter', speed: 22, r: 7, hp: 34, fireEvery: 2.0, bulletSpeed: 40, spread: 3 }], minions: [{ type: 'bouncer', n: 3, speed: 26 }, { type: 'chaser', n: 1, speed: 15 }], boxes: 4 },
    { bosses: [{ type: 'hunter', speed: 28, r: 7, hp: 34, dashEvery: 2.6, dashMul: 2.6 }], minions: [{ type: 'wander', n: 4, speed: 26 }], boxes: 4 },
    { bosses: [{ type: 'spawner', speed: 24, r: 8, hp: 36, spawnEvery: 3, spawnCap: 8, spawnType: 'chaser' }], minions: [{ type: 'bouncer', n: 3, speed: 28 }], boxes: 4 },
    { bosses: [{ type: 'shooter', speed: 24, r: 7, hp: 36, fireEvery: 1.7, bulletSpeed: 44, spread: 5 }], minions: [{ type: 'chaser', n: 3, speed: 16 }], boxes: 4 },
    { bosses: [{ type: 'hunter', speed: 26, r: 6, hp: 26, dashEvery: 3, dashMul: 2.4 }, { type: 'shooter', speed: 22, r: 6, hp: 26, fireEvery: 2.2, bulletSpeed: 40, spread: 3 }], minions: [{ type: 'bouncer', n: 3, speed: 28 }], boxes: 4 },
  ],
  defaultTarget: 80,
  loopSpeedMul: 1.15, // after the last round, the rounds repeat this much faster
};
