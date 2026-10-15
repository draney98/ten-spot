# Acceptance tests

Do these on a phone-width window (390 × 844 in browser dev tools), Normal difficulty, Icons style, unless the test says otherwise.

- Reload with an empty `localStorage` before each section (dev tools → Application → Clear storage).
- `window.__nm.load(values, extra)` is the optional test hook from the reference `app.js`. It replaces the board with exact values.
- Cells are counted 0-based from the top-left, left to right.

Mark each line PASS or FAIL.

---

## A. Rules (automated)

| # | Do | Expect |
|---|---|---|
| A1 | `node tests/logic.test.js` | `54 passed, 0 failed` |

## B. First screen

| # | Do | Expect |
|---|---|---|
| B1 | Open the page | Matches `images/01-phone-light.png`: 27 square cells in 3 rows of 9, top row 1–9 |
| B2 | Read the header | `Number Match`, subline `Level 1 on Normal, points ×1.5` |
| B3 | Read the scoreboard | Three columns only: Score 0, Best 0, Cleared `0%`. No Moves or Left |
| B4 | Look at the bottom bar | Undo faded with `5 left`, Hint with `3 left`, `Add icons` / `5 of 5 left this level` |
| B5 | Status line | `Select two icons to clear them.` |
| B6 | Shrink the window to 320px wide | No horizontal scrollbar; cells still square |

## C. Pairing

| # | Do | Expect |
|---|---|---|
| C1 | Tap cell 0 (`1`) | A yellow highlighter swipe appears behind it |
| C2 | Tap cell 0 again | Deselects |
| C3 | Tap cell 0, then cell 9 (`1` below) | Both flash under the highlighter; a pencil line joins them, pencil flecks fly, `+30` rises in red pencil; both end faded with a red-pencil strike. Score 30 (style bonus: two outlines), Cleared 7%, tag `+30`, status `Both outlines: style bonus +15.` |
| C4 | Wait 1.5 s | Tag disappears; `#fx` is empty |
| C5 | Tap cell 1 (`2`), then cell 2 (`3`) | Cell 2 shakes and is now the selected cell; status `Pick two identical icons, or an icon and its mirror image. −17 points.`; score 13; tag `−17` |
| C6 | Fresh game. Tap cell 0 (`1`), then cell 8 (`9`) | Fails; status `Not reachable: only crossed-out cells can sit between a pair.` No points lost (it would be a match) |
| C7 | Fresh game. Tap cell 8 (`9`), then cell 9 (`1`) | Clears (wrap rule), with the red/pink mixed-pair line; score stays 0 (`… cleared, but no points.`) |
| C8 | Fresh game. Tap cell 0 (`1`), then cell 10 (`1`, diagonal) | Clears |
| C9 | Settings → Hard. Tap cell 0, then cell 10 (diagonal) | Clears: diagonals are allowed on every difficulty. Scores 50 ((10 + 10 style bonus) × 2.5) |
| C10 | Tap a cleared cell | Nothing happens |

## D. Scoring

| # | Do | Expect |
|---|---|---|
| D1 | Fresh game: clear cell 0 + cell 9, then right away cell 8 (`9`) + cell 17 (`1` below it) | The second pair is mixed (outline 1 + filled 9): it clears with a **red** pencil line over a **pink** highlighter and `−9` (half of 18). Score 21; tag `−9, combo ×2`; status `Outline + shaded: cleared, but −9 points.` (`images/28-mixed-pair.png`) |
| D2 | Make a bad pick, then a valid pair | The valid pair has no combo bonus again (combo reset) |
| D2b | Fresh game, pick `2` (cell 1) then `3` (cell 2) | Score stays 0: penalties never take the score below 0 |
| D2c | Clear 1+1 (score 30), mismatch 2 vs 3 (score 13), tap Undo | Score 0 (the match is undone, the 17-point penalty is not refunded) |
| D2d | Gridiron: `__nm.load([2,2,1,4,3])`, clear the two solid longhorns | Status `Both shaded: style bonus +15.` |
| D3 | `__nm.load([1,9,2,8,3,7,4,6,5, 5,1,2])` on Easy. Clear 1-9, 2-8, 3-7, 4-6, then the two 5s | The last pair shows a highlighter sweep across row 0; status `Row cleared! +50`; about 0.9 s later the row disappears and the rest moves up |

## E. Add / Undo / Hint

| # | Do | Expect |
|---|---|---|
| E1 | Fresh game, tap Add icons | 27 new cells grow in below; `4 of 5 left this level`; status `Added 27 icons. 4 adds left this level.` |
| E2 | Tap Undo | New cells gone; Add shows `5 of 5`; Undo shows `4 left` |
| E3 | Tap Hint | Cells 0 and 9 get pulsing pencil circles for about 2 s; Hint shows `2 left` |
| E4 | Use all 3 hints | Hint button greyed out |
| E5 | Settings → Easy | Undo and Hint show `∞ left`; Add shows `8 of 8` |

## F. Levels and end cards

| # | Do | Expect |
|---|---|---|
| F1 | `__nm.load([3,7])`, tap both | After about 0.6 s the card shows `LEVEL 1 CLEARED`, `Board clear!`, `+1,163`, `New best score!`, button `Next level`. Score 1,230 (the 3 + 7 pair is mixed: row bonus 75 − 8) |
| F2 | Tap Next level | Subline starts `Level 2 on`, 36 random cells, Add `5 of 5`, Undo/Hint counts reset, status `Level 2: 36 numbers, 5 adds.`, score still 1,230 |
| F3 | `__nm.load([3,7], {level:2})`, tap both, tap Next level | Chip `Level 3`, 44 cells, Add shows `4 of 4` on Normal |
| F4 | `__nm.load([2,2,1,3,1,3,1,3,1], {addsLeft:0})`, tap both 2s | `OUT OF MOVES ON LEVEL 1`, `Game over`, `30`, buttons `Play again` and `Undo last move` |
| F5 | Tap Undo last move | Card disappears; the 2s are back |
| F6 | Repeat F4, tap Play again | Level 1 classic board, score 0, Best still shown |
| F7 | Reload the page | Best is still there (saved per difficulty) |

## G. Settings, styles, theme

| # | Do | Expect |
|---|---|---|
| G1 | Tap the Settings icon | The panel opens between header and scoreboard (`images/05-phone-settings.png`); the icon is filled dark |
| G2 | Mahjong (mid-game) | Confirm dialog `Switch to Mahjong?`. Tap Switch to Mahjong: new 28-tile game of circle tiles plus 東 and 南 (`images/07-style-tiles.png`); Add button reads `Add tiles` |
| G3 | Numbers | Confirm dialog (rules change), then digits in graphite (`images/06-style-numbers.png`); Add button reads `Add numbers` |
| G4 | Icons | No dialog, board kept. Mirror icons with corner numbers; 1–5 pure outlines, 6–9 completely filled (`images/08-style-icons.png`) |
| G5 | Reload | The chosen style is kept |
| G6 | Tap the moon icon | Dark theme (`images/02-phone-dark.png`); icon becomes a sun; the Appearance segment shows Dark |
| G7 | Reload | Dark is kept |
| G8 | Clear storage, set the OS/browser to dark, reload | Starts dark |
| G9 | Change difficulty mid-game | Dialog `Switch to Hard?` … `You’re on level 1 with 30 points.` Keep playing: nothing changes. Switch to Hard: new game at level 1, score 0, Settings closes |
| G10 | Open Settings, try tapping a cell, Undo, Add | Nothing happens; board, bottom bar and status line are faded |
| G11 | Fresh board (no moves), tap New game | Starts at once, no dialog |
| G12 | Mid-game, New game, press Escape | Dialog closes, game unchanged |
| G13 | Read the difficulty help for each level | No mention of diagonals |
| G14 | Clear a pair, look at it | The cleared cell is very faint, with a faint red strike; it no longer competes with live cells |

## H. Desktop

| # | Do | Expect |
|---|---|---|
| H1 | Widen to 1280px | Two columns like `images/11-desktop-light.png`; Settings closed until the Settings icon is tapped; bottom bar not sticky |
| H2 | Dark at 1280px | Like `images/12-desktop-dark.png` |

## I. Robustness and accessibility

| # | Do | Expect |
|---|---|---|
| I1 | Tab through the page | Every button shows a blue focus ring; Enter/Space activates it |
| I2 | Turn on reduced motion (OS setting, or dev tools → Rendering → emulate) | No flashes, shakes, flecks or slides; game still works |
| I3 | Private window (or block site data) | Game works; best/theme just don't persist |
| I4 | Tap very fast during a match animation | No errors in the console; no stuck highlighted cells |
| I5 | Play 10+ adds on Easy until the board is long | Page scrolls; bottom bar stays pinned to the bottom of the screen |

## J. Gridiron mode

| # | Do | Expect |
|---|---|---|
| J1 | Settings → Tile style → Gridiron (confirm if asked) | New game starts: 28 mascot tiles, no numbers or corner digits; subline `Level 1 on Normal, points ×1.5`; status `Select two tiles to clear them.` Looks like `images/24-phone-gridiron.png` |
| J2 | `__nm.load([1,2])`, tap both | Longhorn outline + longhorn solid clear; board clear card |
| J3 | `__nm.load([3,3])`, tap both | Two identical paw outlines also clear |
| J4 | `__nm.load([2,3,1,6])`, tap cell 0 then cell 1 | Fails with `Pick two tiles with the same mascot.`; cell 0's aria-label is `Longhorn, solid` |
| J5 | `__nm.load([9,10])` | The solid football (cell 1) shows its laces cut out in the tile colour |
| J6 | `__nm.load([9,10])`, clear, tap Next level | Status `Level 2: 36 tiles, 6 mascots, 5 adds.` and a bone tile can appear |
| J7 | Switch to Icons | New classic game (27 numbers); switching between Numbers and Icons afterwards keeps the board |
| J8 | Reload while in Gridiron | Starts in Gridiron |
| J9 | Dark theme in Gridiron | Looks like `images/23b-style-gridiron-dark.png` |

## K. Mahjong mode

| # | Do | Expect |
|---|---|---|
| K1 | Mahjong. `__nm.load([11,12,3,7,15,15,17,17,16])` | 東 南 3 circles, 7 circles, 中 中, two white-dragon frames, 發. Cell 0's aria-label is `East wind`, cell 2's is `3 circles` |
| K2 | Tap cell 0, then cell 1 | Fails: `Pick two identical tiles, or circle tiles that add up to 10.` |
| K3 | Tap cell 2, then cell 3 | 3 + 7 circles clear |
| K4 | Tap cell 4, then cell 5 | The two red dragons clear |
| K5 | `__nm.load([16,16])`, clear, Next level | Status `Level 2: 36 tiles, 3 kinds of winds and dragons, 3 adds.` (on Hard) or `… 5 adds.` (Normal) |
| K6 | Reload while in Mahjong | Starts in Mahjong |

## L. Tile looks

| # | Do | Expect |
|---|---|---|
| L1 | Numbers style | 1–5 in coloured outlined boxes, 6–9 reversed out of filled boxes; 1 and 9 share blue, 2 and 8 green, 3 and 7 orange, 4 and 6 red, 5 purple (`images/06-style-numbers.png`) |
| L2 | Mahjong style | 1–5 circles are rings, 6–9 are filled discs; winds show E / S / W / N in the corner (`images/07-style-tiles.png`) |
| L3 | Icons style | 2 and 8 are a lightning bolt (outline / filled); nothing else looks like the arrowhead |
| L4 | Compare light and dark | Every colour is easy to tell apart at arm's length (`images/16`/`17-cell-artwork-*.png`) |
| L5 | Hint once on a fresh board, then tap New game | The confirm dialog appears (a used hint counts as a game in progress) |
| L6 | Board with a mixed pair and a same-style pair, tap Hint | The hint circles the same-style pair |
| L7 | Clear a mixed pair with points on the board, then Undo | The points come back |
