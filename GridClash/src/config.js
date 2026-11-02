// Gameplay tunables. Units: grid cells, cells per second, seconds.
window.GC_CONFIG = {
  gridW: 160,
  gridH: 120,
  cell: 5, // pixels per cell -> 800x600 arena

  matchSeconds: 180,
  winPercent: 50, // first to hold this share of the (shrinking) arena wins instantly
  koLoss: 0.3, // share of their land a knocked-out player loses (to the killer, or free if none); they keep the rest
  suddenDeath: 30, // last N seconds: no respawns, last one standing wins

  speed: 30,
  dashMul: 2,
  slowMul: 0.5, // after bumping into a shielded line
  rewindSpeed: 30, // human ship rewinding its line when Space is released

  baseSize: 7,
  respawnSize: 5,
  respawnDelay: 3,
  trapPad: 3, // a trapped player is thrown to the center with this tiny base

  energyMax: 100,
  energyPerCell: 0.06,
  energyPerKill: 30,
  abilityCooldown: 0.4,
  abilities: {
    dash: { cost: 25, dur: 1.2 },
    shield: { cost: 40, dur: 2 },
    freeze: { cost: 50, dur: 1 },
  },
  shieldSlowDur: 1,

  // Rewards on top of the land rules: they give energy, never land.
  orbs: { first: 4, every: 5, max: 5, energy: 25, surge: 60, surgeChance: 0.2 }, // energy cells on free land
  streakWindow: 6, // seconds between knockouts that still count as a streak
  revengeEnergy: 20, // knocking out whoever knocked you out last
  bountyEnergy: 25, // knocking out or trapping the crown holder
  crownAfter: 5, // the leader gets the crown from this second on
  closeCallMin: 8, closeCallDist: 3, closeCallEnergy: 10, // closing a long line with a rival this close
  respawnEnergy: 30, spawnShield: 1.5, // comeback after a knockout
  catchUp: 0.75, // up to +75% energy from claims when far behind the leader

  // Shrinking arena: one ring of the outer edge burns away every `every` seconds.
  zone: { start: 50, every: 4.5, maxInset: 24, warn: 3 },

  players: [
    { name: 'YOU', color: [79, 209, 255] },
    { name: 'VIPER', color: [255, 79, 163], isBot: true, aggr: 0.85 },
    { name: 'BOLT', color: [255, 200, 60], isBot: true, aggr: 0.55 },
    { name: 'MOSS', color: [100, 230, 110], isBot: true, aggr: 0.3 },
  ],
};
