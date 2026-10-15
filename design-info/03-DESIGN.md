# Number Match — visual design

The source of truth is `reference/src/styles.css`. Copy it. This document explains it and lists the pictures to check against.

**The look in one sentence:** a sheet torn from a green engineering computation pad. Pale green paper with a faint grid, graphite-grey ink, red-pencil strike-throughs, a yellow highlighter for the selected cell, and real coloured-pencil pigments for the tiles. The dark theme ("Chalkboard") is a slate-green board with chalk colours.

**Why:** Number Match is a pencil-and-paper game. Every colour and mark comes from real stationery, so it doesn't read as a generic app template. Keep it that way:

- no cards with drop shadows;
- no pastel candy colours;
- no ALL-CAPS labels;
- no pill badges;
- no dot-separated "A · B · C" strings;
- no monospace numbers.

---

## 1. Typeface

One family, loaded from Google Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&display=swap" rel="stylesheet">
```

**Barlow** (based on California highway signage, which suits the engineering-pad idea) is used for everything.

| Weight | Used for |
|---|---|
| 700 | Title, cell digits, score values, button labels, the selected segment, setting headings, end-card title and number |
| 400 | Body text, labels ("Score", "Best"), help text, status line, "N left" under Undo/Hint, the second line of Add numbers |

Numbers use `font-variant-numeric: tabular-nums` in the scoreboard so they don't jiggle. Labels are sentence case ("Score", "Difficulty"). **Never** uppercase or letter-space them.

---

## 2. Colour tokens

All colours are CSS custom properties. The light theme sits on `:root`, the dark theme on `:root.dark` (JavaScript toggles the `dark` class on `<html>`). In the settings, the themes are called **Paper** and **Chalkboard**.

| Token | Paper (light) | Chalkboard (dark) | Used for |
|---|---|---|---|
| `--bg` | `#e3e9d8` | `#18211d` | Page background |
| `--paper` | `#f2f6ea` | `#1f2b25` | The sheet (board), end card, text on dark buttons |
| `--card` | = `--paper` | = `--paper` | Alias kept for older rules |
| `--grid` | `#c9d8b5` | `#2d3c34` | Grid lines between cells |
| `--line` | `#b8c5a6` | `#3b4b42` | Button borders, progress track, sheet edges |
| `--ink` | `#2c2f2b` | `#e8e5d8` | Graphite (or chalk): text, rules, primary button fill |
| `--muted` | `#59614f` | `#a7b0a3` | Labels, help text, status line |
| `--done` | `#ccd5c0` | `#34443b` | Cleared-cell content. Deliberately faint: barely darker than the paper, so cleared cells recede |
| `--strike` | `#b23a2e` | `#e3877a` | Red pencil: strikes, "+15" marks, combo text, bad pick |
| `--sel` | `#f3e24c` | `#d9c75e` | Yellow highlighter: selection, match flash, row sweep |
| `--pen` | `#f6a9a1` | `#8e3a34` | Pink highlighter: marks a mixed (penalised) pair |
| `--sel-ink` | `#2c2f2b` | `#1f2b25` | Ink on the highlighter |
| `--focus` | `#27466f` | `#9dbce3` | Keyboard focus ring |
| `--binding` | `#30503d` | `#0e1411` | Gummed binding strip on top of the sheet |
| `--overlay` | `rgba(242,246,234,.96)` | `rgba(31,43,37,.96)` | End-of-level card |
| `--bar` | `rgba(227,233,216,.95)` | `rgba(24,33,29,.95)` | Sticky bottom bar |
| `--blend` | `multiply` | `normal` | Highlighter blend mode (it multiplies into the paper in light mode) |

### Coloured-pencil inks (every tile style)

Tiles are **ink on paper**. There are no coloured tile backgrounds except the shaded number boxes; only the mark itself is coloured. The inks are strong and far apart in hue so every family reads at a glance: dark enough to stand out on Paper, bright enough on Chalkboard.

- Numbers, Icons and Mahjong circle tiles: the family is `min(v, 10 − v)`, so values that add to 10 share a pencil (h1–h5).
- Gridiron: each mascot has its own pencil (h1–h8, see §6b).
- Winds use graphite (`h0` = `--ink`).

| Token | Pigment | Classic values | Paper | Chalkboard |
|---|---|---|---|---|
| `--h1i` | Blue | 1, 9 | `#1747a6` | `#79adff` |
| `--h2i` | Green | 2, 8 | `#1d7a2c` | `#6fdc79` |
| `--h3i` | Orange | 3, 7 | `#c25400` | `#ff9a3d` |
| `--h4i` | Red | 4, 6 | `#c4122f` | `#ff6470` |
| `--h5i` | Purple | 5 | `#7426b5` | `#c792ff` |
| `--h6i` | Teal | Gridiron only | `#00737d` | `#3fd6d0` |
| `--h7i` | Ochre | Gridiron only | `#946200` | `#ffd23f` |
| `--h8i` | Lamp black | Gridiron only | `#1e2328` | `#f4f1e6` |

### Outline and shaded

Every style has two looks, and a pair drawn the same way earns the style bonus (`02-SPEC.md` §5): **outline** for 1–5 (odd values in Gridiron) and **shaded** for 6–9 (even values in Gridiron). Winds and dragons have no shading.

---

## 3. Layout

See `images/21-layout-regions.png` and `images/20-phone-layout-annotated.png`.

- **One set of HTML elements**, arranged with CSS `grid-template-areas`.
- **Phone (default):**
  - single column, `max-width: 560px`, centred;
  - page padding `16px 16px 0`, gap 14px;
  - areas top to bottom: `head`, `settings`, `stats`, `board`, `note`, `actions`;
  - the `note` row is `1fr`, so the bottom bar sits at the bottom of the screen.
- **Bottom bar (`actions`) on phones:**
  - `position: sticky; bottom: 0`;
  - full-bleed (`margin: 0 -16px`);
  - `--bar` background with a 1.5px `--line` top rule;
  - bottom padding includes `env(safe-area-inset-bottom)`.
- **Desktop (≥ 960px):**
  - two columns `minmax(0,1fr) 340px`, gap 36px, `max-width: 1040px`;
  - the board is on the left; stats, actions, note and settings stack on the right;
  - Settings starts closed and opens with the Settings button, exactly like on the phone (it switches the board off while open);
  - the bottom bar is not sticky.
- **No horizontal scroll** at any width ≥ 320px.

---

## 4. Components

| Component | Spec |
|---|---|
| **Header** | Flex row, gap 8px. Left: `h1` "Number Match" 27px/700. Under it, the subline 14px `--muted`: `Level 1 on Normal, points ×1.5`. Right: three icon buttons. There is no level badge. |
| **Icon button** | 44×44, radius 6, 1.5px `--line` border, transparent background, `--ink` icon (20px stroke SVGs, stroke-width 2, in `index.html`). Hover: border `--ink`. The Settings button is solid `--ink` with a `--paper` icon while open. |
| **Settings panel** | Not a card. A section with a 1.5px `--ink` rule above and below, padding 16px 0, gap 18px. Four groups, each a 15px/700 sentence-case heading (`Difficulty`, `Tiles`, `Appearance`, `How to play`), a segmented control, then 13.5px `--muted` help text. Opens with a 0.2s drop. |
| **Segmented control** | Full-width row of equal buttons inside a 1.5px `--ink` border, radius 6, 1.5px `--ink` dividers, min-height 44px, 14px/400. Selected (`aria-pressed="true"`): solid `--ink`, `--paper` text, 700. The labels are `Easy / Normal / Hard`, `Numbers / Mahjong / Icons / Gridiron` and `Paper / Chalkboard`. |
| **Scoreboard** | A tally line, not a card. 3 columns `1fr 1fr auto`, gap 14px, labels aligned at the top: `Score` and `Best` (values 32px/700), and `Cleared` (value 24px/700, right-aligned, e.g. `7%`), each under a 13px `--muted` label. The **score tag** (`+30`, `+18, combo ×2`, or `−17` after a mismatch) sits after the word Score in red pencil (`--strike`, 700). Below: a full-width 5px square progress bar (track `--line`, fill `--ink`). A 1.5px `--ink` rule closes the section. |
| **Board (the sheet)** | `--paper` background, radius 3px, padding `22px 10px 12px`. A 12px **binding strip** (`--binding`) runs across the top (`::before`). Two more sheets peek out underneath, drawn with `box-shadow: 0 3px 0 -1px var(--paper), 0 3px 0 0 var(--line), 0 6px 0 -1px var(--paper), 0 6px 0 0 var(--line)`. |
| **Grid** | `repeat(9, minmax(0,1fr))` with **no gap**. The grid has a 1px `--grid` top and left border; every cell has a 1px `--grid` right and bottom border. The board IS the pad grid. |
| **Cell** | A real `<button>`, `aspect-ratio: 1`, no radius, transparent background. Digits 700 at `clamp(17px, 5.4vw, 27px)`. Hover (not cleared): a faint grey-green wash `rgba(127,140,110,.12)`. |
| **Status line** | 15px `--muted`, centred (left-aligned on desktop), `aria-live="polite"`. |
| **Undo / Hint** | 72px wide, min-height 56px, radius 6, 1.5px `--line` border, transparent. Icon, then the label 13px/700, then `5 left` (or `∞ left`) 11px/400 `--muted`. Disabled: opacity .4. There are no badges. |
| **Add button** | Primary button: solid `--ink`, `--paper` text, radius 6, min-height 56px, fills the remaining width. Plus icon, then `Add numbers` / `Add tiles` / `Add icons` / `Add mascots` (16px/700, `id="addMain"`, follows the tile style) over `N of M left this level` (12.5px/400). |
| **Switched-off board** | While Settings or the confirm dialog is open, `#board`, `#actions` and `#note` get `inert` and class `is-off`: `opacity: .35; filter: saturate(.4); transition: opacity .2s`. |
| **Confirm dialog** | `images/27-phone-confirm.png`. A fixed backdrop (`rgba(44,47,43,.35)`, dark `rgba(0,0,0,.5)`) centres a small sheet: `--paper`, max-width 380px, radius 3, padding `26px 20px 18px`, a 10px `--binding` strip on top, one peeking sheet underneath (`box-shadow: 0 3px 0 -1px var(--paper), 0 3px 0 0 var(--line)`). Title `h2` 22px/700, text 15px `--muted`, buttons right-aligned: `Keep playing` (outline button) and the Yes button (primary). `role="alertdialog"`, `aria-modal="true"`, labelled by `#confirmTitle`, described by `#confirmText`. |
| **End card** | Covers the sheet below the binding strip (`inset: 12px 0 0 0`; the sheet gets min-height 360px while it shows). `--overlay` background. Kicker 15px `--muted` (e.g. `Level 1 cleared`), title 36px/700, then the big number 44px/700 in red pencil, rotated −4° like a teacher's mark, detail 15px `--muted`, best line 15px/700, buttons. Fades in after 0.6s. |

---

## 5. Cell states

Rules later in the CSS override earlier ones. **Keep this order.**

| State | Class | Look |
|---|---|---|
| Normal | `c` | Graphite mark on paper |
| Pencil colour | `c-tile h1…h8` | The mark uses that pigment (`--tink`) |
| Selected | `c-sel` | A **yellow highlighter swipe** behind the mark: `::before` at `inset: 16% 5%`, `--sel`, `mix-blend-mode: var(--blend)`, uneven corners `2px 5px 3px 6px`, rotated −4°. The cell does not grow or move. |
| Done | `c-done` | Mark (digit, circles, character, icon, corner number) in `--done`, plus a **red-pencil strike** at **opacity .4** (`::after`: 2px, from 16% to 84% of the width, rotated −38°, drawn with a scaleX transition of 0.28s after 0.3s) |
| Just matched | `c-flash` | `nmPop` 0.55s: highlighter background, scale to 1.14, back to normal |
| Bad pick | `c-bad` | `nmShake` 0.32s, mark turns red pencil (`.c.c-bad { --tink: var(--strike) }` so coloured tiles turn red too) |
| Hint | `c-hint` | A **pencil circle** round the cell: `::before` at inset 7%, 2px `--ink` border, wobbly radius `46% 54% 50% 48%`, rotated 8°, pulsing opacity (`nmPulse` 1s) |
| Just added | `c-born` | `nmBorn` 0.4s fade-in |

---

## 6. Tile artwork

See `images/16-cell-artwork-light.png` and `17-cell-artwork-dark.png`.

**Numbers:** the digit inside a box, `class="numbox"`: 72% of the cell, radius 4, `2.5px solid var(--tink)`, digit 700 at `clamp(15px, 4.8vw, 24px)` in `--tink`. **6–9** add class `solid`: the box is filled with `--tink` and the digit is `--paper` (reversed out). Cleared: border and digit `--done`; a cleared solid box is filled `--done` with a `--paper` digit.

**Mahjong** (internal mode name `tiles`). See `images/07-style-tiles.png`.

- **Circle tiles (1–9):** a 3×3 grid, 80% of the cell, gap 6%. **1–5** are heavy rings with a dot in the middle: `radial-gradient(circle, var(--tink) 0 28%, transparent 31% 43%, var(--tink) 46% 70%, transparent 73%)`. **6–9** add class `solid` to `.pips` and are filled discs: `radial-gradient(circle, var(--tink) 0 70%, transparent 73%)`. Cleared circles are `--done` discs. Positions (0 = top-left, 8 = bottom-right):

| Value | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Circles | 4 | 0 8 | 0 4 8 | 0 2 6 8 | 0 2 4 6 8 | 0 2 3 5 6 8 | 0 2 3 4 5 6 8 | 0 1 2 3 5 6 7 8 | all |

- **Winds and dragons (11–17):** one Chinese character, class `honour`, 700 weight, `clamp(16px, 5.2vw, 26px)`, font stack `'Noto Serif TC', 'Noto Serif CJK TC', 'Songti TC', 'PMingLiU', 'MingLiU', serif`. Load Noto Serif TC from Google Fonts with `&text=東南西北中發` so only those six characters download.

| Value | Tile | Shows | Pencil class |
|---|---|---|---|
| 11 / 12 / 13 / 14 | East / South / West / North wind | 東 / 南 / 西 / 北 | `h0` (graphite: `.c-tile.h0 { --tink: var(--ink) }`) |
| 15 | Red dragon | 中 | `h4` red |
| 16 | Green dragon | 發 | `h2` green |
| 17 | White dragon | an empty frame: `<rect x="5" y="3" width="14" height="18" rx="1.5" stroke-width="2"/>` plus `<rect x="8.2" y="6.2" width="7.6" height="11.6" rx="1" stroke-width="1.4"/>`, `fill="none"` | `h1` blue |

- The four winds also show a small Latin letter in the top-left corner (`E`, `S`, `W`, `N`, class `corner`), so players who don't read the characters can still tell them apart. Circle tiles and dragons have no corner mark.

**Icons (mirror pairs).** Every icon is **either a pure outline or completely filled**: nothing half-filled, no tinted fills.

- one closed 24×24 SVG path per family;
- the **low** value (1–4) is drawn as given, as an **outline** (`fill-opacity="0"`);
- the **high** value (6–9) is the same path **mirrored left-right** (`transform="matrix(-1 0 0 1 24 0)"`) and **filled** (`fill-opacity="1"`). The chevron is a thick closed arrowhead so it can be filled too;
- 5 pairs with itself, so it is a plain **outline ring**;
- the SVG is 68% of the cell, stroke-width 2.2, round joins and caps, in the family pencil;
- the value is also shown as a small 700-weight number in the top-left corner (`clamp(8px, 2.3vw, 12px)`).

| Value | Shape | Path `d` | Mirrored | Fill |
|---|---|---|---|---|
| 1 | `<` arrowhead | `M16 2.5 6.5 12 16 21.5 20 17.5 14.5 12 20 6.5Z` | no | 0 |
| 9 | `>` arrowhead | same | yes | 1 |
| 2 | lightning bolt | `M14.5 2 5 13.5h6.2L9.5 22 19 10h-6.3L14.5 2Z` | no | 0 |
| 8 | lightning bolt | same | yes | 1 |
| 3 | crescent | `M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z` | no | 0 |
| 7 | crescent | same | yes | 1 |
| 4 | leaf | `M5 19C5 10 10 5 20 4c0 10-5 15-14 15Z` | no | 0 |
| 6 | leaf | same | yes | 1 |
| 5 | ring | `M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17Z` | no | 0 |

### 6b. Gridiron mascots

See `images/25-gridiron-mascots-light.png`, `images/26-gridiron-mascots-dark.png` and `images/23-style-gridiron.png`.

- The exact SVG paths are in `reference/src/app.js` → `MASCOTS`. **Copy them; do not redraw them.**
- These are original generic symbols that bring teams to mind. They are **not** team logos and use no team colours. Never replace them with real logos (trademarks).
- **Outline tile (odd value):** `fill-opacity="0"`, stroke 2, round joins and caps, in the mascot's pencil. **Solid tile (even value):** the same path with `fill-opacity="1"` and `fill-rule="evenodd"`, so cut-outs stay open.
- **Knock-out detail:** the football's laces and the feather's spine are re-drawn on the SOLID tile as a second path, class `knock`, `fill="none"`, stroke-width 1.5, stroke `var(--paper)`. It becomes `var(--sel)` when the tile is selected.
- **No corner number** on Gridiron tiles.

| # | Mascot | Brings to mind | Pencil | Knock-out |
|---|---|---|---|---|
| 1 | Longhorn steer head (front) | Texas | h3 orange | — |
| 2 | Tiger paw (pad + 4 toes) | LSU, Clemson, Auburn, Missouri | h5 purple | — |
| 3 | Crested Trojan helmet (profile, eye slot) | USC, Michigan State | h4 red | — |
| 4 | Shamrock (3 heart leaves + stem) | Notre Dame | h2 green | — |
| 5 | Football (with laces) | every team | h8 lamp black | laces |
| 6 | Bone | Georgia Bulldogs | h7 yellow ochre | — |
| 7 | Feather (with quill) | Florida State, Utah | h6 teal | spine |
| 8 | Claw marks (3 slashes) | Michigan Wolverines | h1 blue | — |

---

## 7. Match animation

See `images/19-match-animation-timeline.png`. Everything is CSS. JavaScript only adds elements and classes.

**Mixed pair** (`images/28-mixed-pair.png`): the same effect, but the group gets class `fx-pen`, so everything is drawn as a correction: the pencil line and ring in red pencil (`--strike`), the wide highlighter stroke and the cell pop in pink (`--pen`, keyframes `nmPopPen`, scale 1.08 instead of 1.14), all flecks red, and the floating number reads `−9` in red on a pink highlighter label. A normal match never uses red for the line.

Effects go in a `.fx` layer: absolutely positioned over the grid, `pointer-events: none`, z-index 4. **Positions are measured** with `getBoundingClientRect()` of the two cells at the moment of the match.

| Time | Element | Animation |
|---|---|---|
| 0 → 0.55s | both cells, class `c-flash` | `nmPop`: highlighter background, scale up to 1.14 at 35%, back to normal and transparent |
| 0 → 0.55s | `<svg>` with two `<line>`s, A centre to B centre, `pathLength="1"` | `nmZap`: draws on by 40%, then fades. Under-line `zap zap-wide`: highlighter `--sel`, width 12, `mix-blend-mode: var(--blend)`. Over-line `zap`: graphite `--ink`, width 2.5. Together it reads as a pencil line over a highlighter stroke. |
| 0.04 → 0.54s | `.ring` at each cell (40px circle, 2px `--ink`) | `nmRing`: scale .4 → 1.6, opacity .8 → 0 |
| 0.08 → 0.68s | 10 `.spark`s per cell: 6px square **pencil flecks** (radius 1px). Classes `s0`–`s9` set the direction, `k0`–`k4` set the colour: orange, blue, red pencil, green, purple. Colour index is `(k + n×2) % 5` | Each flies out at 36° steps, alternating 30px and 22px away, spinning 90° and fading |
| 0.10 → 0.95s | `.floatpt` `+{gain}` at the midpoint, **written in red pencil**: 700, 22px, `--strike`, rotated −6°, no background | `nmFloat`: fades in, rises about 2× its height, fades |
| 0.15 → 0.85s | `.sweep` over each row emptied by this pair | Highlighter bar: scaleX 0 → 1 from the left, peak 75% opacity, fades |
| 0.3 → 0.58s | red-pencil strike | draws across the done cells |
| 0.62s | | JS removes `c-flash` |
| 0.9s | | JS collapses fully-done rows (§9 of the spec) |
| 1.0s | | JS removes the effect group |
| 1.4s | | JS clears the "+gain" part of the score tag |

**Other animations:**

| Animation | Spec |
|---|---|
| Shake (bad pick) | `nmShake`, 0.32s: translateX −4, +4, −2, +2, 0 |
| Hint | `nmPulse`, 1s infinite: the pencil circle fades 1 → .35 → 1 |
| Born (new cells after Add) | `nmBorn`, 0.4s fade-in |
| End card | `nmWin`, 0.45s after a 0.6s delay: up from 8px, fading in |
| Settings panel open | `nmDrop`, 0.2s |
| Theme switch | `body` background-color and color transition over 0.3s |

**Reduced motion:** with `@media (prefers-reduced-motion: reduce)`, turn all of the above off and hide `.fx`. The game must stay fully playable.

---

## 8. Accessibility (required)

- Every control is a real `<button>`. Never use a clickable `<div>`.
- Icon-only buttons have an `aria-label`: `New game`, `Dark mode`, `Settings`.
- Cells have an `aria-label`: `"7"`, `"7, selected"`, `"7, cleared"` (Gridiron: `"Longhorn, solid"` and so on).
- Toggle states use `aria-pressed` (segments, theme button) and `aria-expanded` (Settings).
- The status line and end card use `role="status"`, and the status line also has `aria-live="polite"`.
- There is a visible focus ring on every control: `outline: 2.5px solid var(--focus)`.
- Touch targets are ≥ 44px, except board cells. Nine columns on a 390px phone makes cells about 36px; this is accepted.
- Text and pencil inks are ≥ 4.5:1 against the paper and the chalkboard.

---

## 9. Picture index

| File | Shows |
|---|---|
| `01-phone-light.png` | Fresh game, phone, Paper theme, Icons style |
| `02-phone-dark.png` | Same, Chalkboard theme |
| `03-phone-selected.png` | After one match: red-pencil strikes, one cell highlighted, bad-pick message |
| `05-phone-settings.png` / `05b-…-dark.png` | Settings panel open on a phone |
| `06/07/08-style-*.png` (+ `b` = dark) | Board in Numbers / Mahjong / Icons |
| `23-style-gridiron.png` / `23b-…-dark.png` | Board in Gridiron: all 5 level-1 mascots, outline and solid, one pair cleared, one tile highlighted |
| `24-phone-gridiron.png` | Whole phone screen in Gridiron |
| `25/26-gridiron-mascots-*.png` | All 8 mascots: outline, solid, cleared, values, level introduced, pencil |
| `09-phone-level-clear.png` | Board-clear card with the bonus in red pencil |
| `10-phone-game-over.png` | Game-over card with Undo option |
| `11-desktop-light.png` / `12-desktop-dark.png` | Desktop two-column layout |
| `13-hint.png` | Pencil circles on a hinted pair |
| `14-phone-bad-pick.png` | Shake and message after a bad pick |
| `15-phone-after-add.png` | Board after Add icons |
| `28-mixed-pair.png` | A mixed pair clearing: red line, pink highlighter, `−9` |
| `27-phone-confirm.png` | Confirm dialog over a switched-off board |
| `16/17-cell-artwork-*.png` | Every value in every style, Paper and Chalkboard |
| `18-pairing-rules.png` | The position rules, valid and invalid |
| `19-match-animation-timeline.png` | Match animation frames |
| `20-phone-layout-annotated.png` | Numbered parts of the phone screen |
| `21-layout-regions.png` | Phone vs desktop grid areas |
| `22-game-flow.png` | Playing, clear, next level, game over |
