# Grid Clash: art prompts

Prompts for generating the game's Cyberpunk theme with an image AI.

How to use it:
1. Attach the concept sheet (`assets/concept_sheet.png`, if you saved it there) and paste **Project brief**, **Art direction** and **Rules for every image** once.
2. Then ask for **one image per message**, using the prompts under **Assets**.
3. Save each file under `GridClash/assets/` with the exact file name shown.

---

## Project brief

```text
PROJECT BRIEF: "Territory War: Grid Clash"

What it is
A browser arcade game (HTML5 Canvas, top-down 2D) that remakes the classic
Volfied / Paper.io area-capture idea. 4 players (you + 3 bots) fly small ships
over a grid arena. You leave your own land to draw a line, and when you return,
the enclosed area becomes yours. Crossing a rival's open line knocks them out
and steals half their land. The arena edge burns inward over time.
First to own 50% of the arena wins. Matches last 3 minutes, and the game
should feel fast, competitive and "one more match".

Technical constraints for images
- Arena: 800x600 px, 4:3, built from 5x5 px cells (160x120 grid).
- Objects are viewed top-down and are tiny on screen, so they need bold,
  readable silhouettes and must work at 16-32 px.
- Ships face RIGHT (they are rotated in code), on a transparent background.
- Player colors are applied by the game, so ship bodies should be
  white / light silver.
- Territory and lines stay code-drawn color cells, so the art must leave
  room for 4 strong player colors to read clearly on top of the background.
  Player colors: cyan rgb(79,209,255), pink rgb(255,79,163),
  yellow rgb(255,200,60), green rgb(100,230,110).
- Formats: PNG with transparency. Backgrounds are PNG or JPG.
```

## Art direction

```text
Art direction: CYBERPUNK
A neon-soaked megacity seen from above, as if the arena were a holographic
tactical map in a hacker's control room. Deep blacks and dark indigo or violet,
with hot neon accents: magenta, electric cyan, acid yellow and toxic green.
Glowing edges, chromatic aberration, light scanlines, subtle glitch artifacts,
HUD and terminal motifs, circuit-board and city-grid patterns, holographic
transparency.

- Ships: sleek hover-drones, angular and hard-edged, with glowing engine
  trails. Clean silhouettes, minimal detail.
- Energy cells: data cores or power crystals with an inner glow.
  Surge is a gold "overclocked" version.
- Crown: a holographic, wireframe-style crown with "#1".
- Ability icons: Dash = neon speed chevrons. Shield = hex-grid force field.
  Freeze = ice-blue crystal shards with a lock.
- Arena background: a dark city grid from above, very low contrast.
  Player colors must stay the brightest thing on screen.
- Menu background: a rainy neon skyline, with room in the center for panels.
- Logo: a glitchy neon sign. "TERRITORY WAR" in cyan, "GRID CLASH" in magenta.
- Fonts: Orbitron or Audiowide for titles, JetBrains Mono or
  Share Tech Mono for the HUD.
Tone: competitive, energetic, readable at a glance. Arcade, not realistic.
Avoid: realism, busy detail at small sizes, text inside images except the logo.
```

## Rules for every image

```text
I'm attaching a concept sheet for my game "Territory War: Grid Clash".
I need you to recreate each item from this sheet as a SEPARATE image file,
matching its style exactly: same shapes, proportions, colors, line weight,
lighting and neon cyberpunk look. Do not redesign; extract and clean up.

Rules for EVERY image:
- One object per image. No frame, no corner brackets, no label, no text,
  no grid, no backdrop, no shadow on the ground.
- Fully TRANSPARENT background (PNG with alpha).
  If you cannot do transparency, use a perfectly flat, solid #000000
  background with no gradient, no vignette and no noise.
- Object centered, with about 10% empty padding on every side.
  Nothing may touch or get cut by the edge, including glow and engine flames.
- Square canvas, 512x512 px (the game scales it down to 24-32 px,
  so keep silhouettes bold and readable; avoid tiny details).
- Top-down view, flat 2D game-sprite style, crisp edges, consistent
  light direction (light from top-left).
- Glow must be soft but compact (stay within the padding).
- Same art style and the same scale logic across all images,
  so they look like one set.
I'll ask for the images one at a time.
```

---

## Assets

| # | File | Size | Use in game |
|---|---|---|---|
| 1 | `dart.png` | 512x512 | Ship, default |
| 2 | `arrow.png` | 512x512 | Ship, unlocks at level 3 |
| 3 | `delta.png` | 512x512 | Ship, level 5 |
| 4 | `orb.png` | 512x512 | Ship, level 8 |
| 5 | `star.png` | 512x512 | Ship, level 12 |
| 6 | `energy.png` | 512x512 | Energy cell pickup (+25 energy) |
| 7 | `surge.png` | 512x512 | Surge cell pickup (+60 energy) |
| 8 | `crown.png` | 512x340 | Crown over the leader |
| 9 | `dash.png` | 512x512 | Ability icon (Z) |
| 10 | `shield.png` | 512x512 | Ability icon (X) |
| 11 | `freeze.png` | 512x512 | Ability icon (C) |
| 12 | `logo.png` | 1024x320 | Menu logo |
| 13 | `arena_bg.png` | 1600x1200 | Behind the arena |
| 14 | `menu_bg.png` | 1600x1200 | Behind the menu and result screens |

### Ships

Ship bodies are white / silver on purpose: the game tints them to each player's color.

```text
Image 1 - dart.png
The "Dart" ship from the sheet. Pointing exactly RIGHT (nose at the right edge,
engines on the left), perfectly horizontal and symmetrical top-to-bottom.
Body in white / light silver with dark-grey panel lines.
Engine flame short and compact, in neutral white-blue.
No colored accents on the body (the game tints it per player).
```

```text
Image 2 - arrow.png
The "Arrow" ship from the sheet. Same rules as dart.png:
pointing exactly RIGHT, horizontal, symmetrical, white/silver body,
dark-grey panel lines, compact white-blue engine glow, no colored accents.
```

```text
Image 3 - delta.png
The "Delta" ship from the sheet. Same rules as dart.png:
pointing exactly RIGHT, horizontal, symmetrical, white/silver body.
Replace the orange circuit details with light-grey ones.
Twin compact white-blue engine flames.
```

```text
Image 4 - orb.png
The "Orb" ship from the sheet: a round armored sphere with a glowing core ring.
Body white/silver with dark-grey panels. Core ring glow in neutral white-cyan
(no orange). Add a small, clear nose or notch on the RIGHT side,
so the direction it faces is visible.
```

```text
Image 5 - star.png
The "Star" ship from the sheet. Pointing exactly RIGHT, horizontal,
symmetrical top-to-bottom. White/silver body with sharp blade wings,
dark-grey panel lines, compact white-blue engine glow, no colored accents.
```

### Pickups and crown

```text
Image 6 - energy.png
The purple "Energy Cell" from the sheet: a capsule with a bright glowing
purple core (#b06bff), dark metal caps. Rotate it 45 degrees (diagonal),
so it reads well as a small pickup. Strong inner glow, compact outer glow.
```

```text
Image 7 - surge.png
The gold "Surge Cell" from the sheet: same capsule shape and angle as
energy.png, but gold (#ffd24f) with bright sparks. It must look like
a stronger, rarer version of the energy cell.
```

```text
Image 8 - crown.png
The holographic "Leader's Crown" from the sheet: wireframe neon crown in
gold (#ffd24f) with a cyan edge glow, and "#1" in the center.
Wide format: 512x340 px canvas, crown centered. Bold lines,
readable at 24x16 px.
```

### Ability icons

```text
Image 9 - dash.png
The "Dash" icon from the sheet: three neon chevrons pointing RIGHT,
gradient from yellow (#ffd24f) to magenta (#ff4fa3). Thick strokes,
no background tile.
```

```text
Image 10 - shield.png
The "Shield" icon from the sheet: a round hexagon-grid force-field sphere
in cyan (#4fd1ff) with a bright rim. No background tile.
```

```text
Image 11 - freeze.png
The "Freeze" icon from the sheet: ice crystal shards in ice-blue (#bfe9ff)
with a small padlock in the center. No background tile.
```

### Logo

```text
Image 12 - logo.png
The game logo from the sheet: "TERRITORY WAR" in a cyan neon sign style
(#4fd1ff) on the first line, and "GRID CLASH" in magenta neon (#ff4fa3)
below it. Keep the slight glitch effect. Remove the frame around it
and the decorative lines. Canvas 1024x320 px, transparent background,
text spelled exactly as written.
```

### Backgrounds

```text
Image 13 - arena_bg.png
Game arena background, 1600x1200 px (4:3), NOT transparent.
A dark top-down cyberpunk city map, like the faint city map behind the sheet:
streets, blocks and rooftops seen from above, in very dark navy and indigo
(around #070912 to #12162e), with very faint thin cyan and purple lines.
VERY LOW contrast and brightness: it sits under colored gameplay,
so nothing in it may be brighter than 20% or draw attention.
No text, no characters, no vehicles, no logo. Even detail across the
whole image (no focal point), and the edges must look as calm as the center.
```

```text
Image 14 - menu_bg.png
Menu background, 1600x1200 px (4:3), NOT transparent.
A cyberpunk city skyline at night in the rain: neon signs in cyan, magenta
and yellow, reflections on wet surfaces, light fog. The center area must be
darker and calmer, because menu panels sit on top of it.
No readable text, no logo, no people in focus.
```

---

## Fixes when a result is off

| Problem | Follow-up prompt |
|---|---|
| Background is not transparent | `Make the background fully transparent, PNG with alpha. No color behind the object.` |
| Ship is tilted | `Rotate so the nose points exactly to the right, perfectly horizontal.` |
| Glow is cut at the edge | `Shrink the object so all glow fits inside the canvas with padding.` |
| Style drifted from the sheet | `Match the attached concept sheet exactly, same style as the previous image.` |
| Too much detail | `Simplify: it must read clearly at 32x32 px. Bolder shapes, fewer small details.` |

## After the files are ready

Put all files in `GridClash/assets/` with the names above. The game code (`src/render.js`, `src/ui.js`, `style.css`) then gets updated to load them, and all colors and fonts move into one theme file.
