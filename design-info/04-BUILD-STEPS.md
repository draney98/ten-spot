# Build steps — give the AI ONE step per message

Each step has a prompt (copy the box) and a **Done when** check you do yourself before sending the next step. If a check fails, tell the AI exactly what's wrong and have it fix that before moving on.

Final file structure:

```
number-match/
  index.html
  styles.css
  game-logic.js   <- copied unchanged from reference/src/
  app.js
```

---

## Step 1 — Game rules (copy, don't write)

```
STEP 1. Create game-logic.js by copying reference/src/game-logic.js
EXACTLY, character for character. Do not change anything.
Then create tests/logic.test.js by copying reference/tests/logic.test.js
exactly (its require path is '../src/game-logic.js'; change only that
path to '../game-logic.js').
Give me both files in full.
```

**Done when:** `node tests/logic.test.js` prints `54 passed, 0 failed`.

---

## Step 2 — Page skeleton and styles

```
STEP 2. Create index.html and styles.css.
- index.html: copy reference/src/index.html exactly. It has every
  element with the ids app.js needs: subline, btnNew,
  btnTheme, btnSettings, settings, diffInfo, styleInfo, score, scoreTag,
  best, pct, progress, progressFill, board,
  boardInner, grid, fx, overlay, endKicker, endTitle, endNumber,
  endDetail, endBest, btnEndPrimary, btnEndUndo, note, btnUndo,
  undoCount, btnHint, hintCount, btnAdd, addSub.
- styles.css: copy reference/src/styles.css exactly.
Do not write any JavaScript yet. The board will be empty.
```

**Done when:** opening `index.html` shows the header, scoreboard, an empty board card and the bottom bar, laid out like `images/01-phone-light.png` (minus the cells). The font is Barlow. The board is a pale green sheet with a dark binding strip on top and a grid. Resizing to 1000px wide gives the two-column layout from `images/11-desktop-light.png`.

---

## Step 3 — Draw the board

```
STEP 3. Create app.js. In this step implement ONLY:
- storage helpers wrapped in try/catch (section 1 of reference app.js)
- state = NumberMatchLogic.newGame('normal', loadBest()) and the ui object
- the cell artwork: PIPS, ICONS, cellInnerHTML, family, cellClass
- syncBoard() exactly as in the reference: buttons are REUSED, keyed by
  cell id, in a Map. Never rebuild all cells with innerHTML on each render.
- render(): theme class on <html>, header texts, scoreboard texts,
  progress bar, syncBoard(), status line, button disabled states and
  "N left" counts, addSub text.
Call render() once at the end. Follow reference app.js sections 1-5 and 7.
```

**Done when:** 27 cells appear in 3 rows of 9, matching `images/01-phone-light.png` (Icons style, coloured). Cells are square. Under the title: `Level 1 on Normal, points ×1.5`.

---

## Step 4 — Tapping and matching (no animation yet)

```
STEP 4. Add cell tapping to app.js:
- ONE click listener on #grid (event delegation): find the closest
  button.c, read data-id, call onCell(id).
- onCell: r = NumberMatchLogic.select(state, id); state = r.state;
  then handle r.event types 'select', 'deselect', 'bad', 'match'
  exactly like reference app.js section 8, BUT skip spawnFx for now.
- Include the timers: later(), tok, the 360ms bad-shake clear, the 620ms
  flash clear, the 900ms row collapse (only if tok unchanged AND
  state.status === 'playing'), and the 1400ms gain clear.
- Use the exact status-line messages from 02-SPEC.md section 13.
```

**Done when:**
- Tapping the top-left `1` puts a yellow highlighter swipe behind it.
- Tapping the `1` below it flashes both, then they fade with a red-pencil strike. Score shows **30** (15 plus a 15-point style bonus: both are outlines), Cleared shows **7%**, `+30` appears in red after the word Score, and the status line reads `Both outlines: style bonus +15.`
- Tapping `2` then `3` shakes the `3`, shows `Pick two identical icons, or an icon and its mirror image. −17 points.`, the score drops to **13** and the tag reads `−17`.

---

## Step 5 — Add, Undo, Hint

```
STEP 5. Wire the bottom bar exactly like reference app.js onAdd, onUndo,
onHint. Use NumberMatchLogic.addNumbers / undo / hint. Respect
canAdd / canUndo / canHint for the disabled state (already in render).
Add numbers marks the new ids in ui.born for 700ms. Hint marks the two
ids in ui.hint for 2200ms. Undo cancels all pending timers, clears #fx,
and clears every transient ui list.
```

**Done when:**
- On a fresh Normal game (nothing cleared yet), the Add button (it reads `Add icons` in the default Icons style) adds 27 cells (3 new rows, the same values again). The button shows `4 of 5 left this level` and the status line reads `Added 27 icons. 4 adds left this level.`
- Undo removes them again and Undo goes from `5 left` to `4 left`.
- Hint draws pulsing pencil circles round the two `1`s at the top-left, and Hint goes to `2 left`.

---

## Step 6 — Match effects

```
STEP 6. Add spawnFx(ev) exactly as reference app.js section 6, and call
it in onCell's 'match' branch BEFORE changing ui.flash. It must:
- measure both cells with getBoundingClientRect relative to #fx
- build one .fx-group containing: a .sweep per row in ev.rowsCleared,
  an <svg class="zap-svg"> with two <line class="zap" pathLength="1">,
  a .ring and 10 .spark (classes s0..s9 and k0..k4) per cell, and one
  .floatpt with '+gain' at the midpoint
- append it to #fx and remove it after 1000ms.
All motion comes from the CSS already in styles.css. Do not animate
with JavaScript.
```

**Done when:** a match looks like `images/19-match-animation-timeline.png`: a pencil line (over a highlighter stroke) joins the cells, pencil flecks fly out, a thin ring expands, and `+30` rises in red pencil. One second later `#fx` is empty again (check in dev tools).

---

## Step 7 — Levels and end cards

```
STEP 7. Implement renderOverlay() and onNextLevel() and newGame()
exactly like the reference:
- when state.status is 'clear' or 'lose', show #overlay with the texts
  from 02-SPEC.md section 13 and add class 'ended' to #board
- primary button: 'Next level' (calls onNextLevel) or 'Play again'
  (calls newGame)
- 'Undo last move' button only when status is 'lose' and canUndo
- onNextLevel and newGame call resetAll() first (clears timers, #fx,
  transient ui, and the board node Map)
- save the best score with saveBestIfHigher() whenever a match or add
  ends the level.
```

**Done when:**
- In the browser console, `window.__nm.load([3,7])` (add the test hook from reference section 10 first) then tapping both cells shows `Board clear!` with `+1,163`. Next level shows `Level 2` and 36 cells.
- `window.__nm.load([2,2,1,3,1,3,1,3,1], {addsLeft:0})` then tapping both `2`s shows `Game over` with an `Undo last move` button that works.

---

## Step 8 — Settings, tile styles, dark mode

```
STEP 8. Wire the header and settings exactly like reference app.js
section 9:
- btnNew → askNewGame(); btnTheme → toggle dark; btnSettings → toggle
  ui.settingsOpen
- [data-diff] buttons → setDifficulty(thatDiff) if different
- New game, difficulty and a rule-set change go through confirmReset()
  (02-SPEC.md section 17): only when a game is in progress, show #confirm
  with the exact texts; Keep playing / Escape / backdrop cancel; Yes runs
  the action and closes Settings. Focus #confirmNo; Tab stays inside.
- while ui.settingsOpen or ui.confirm: #board, #actions and #note get
  inert = true and class 'is-off'
- #addMain text = 'Add ' + NOUN[mode] (numbers / tiles / icons / mascots)
- [data-mode] buttons → setMode(mode) (saved to localStorage
  'numbermatch.mode')
- [data-theme] buttons → setTheme(dark) (saved to 'numbermatch.theme')
- the 2nd Tile style button is Mahjong (data-mode="tiles") and the 4th is
  Gridiron (data-mode="teams"). Add the HONOURS, WHITE_DRAGON and MASCOTS
  tables, the 'tiles' and 'teams' branches of cellInnerHTML (with the
  knock path), family()/cellName() for both, and rulesFor(mode). setMode
  starts a NEW game (after confirming) only when the rule set changes
  (classic / mahjong / pairs). See 02-SPEC.md sections 15, 16 and 17.
- first visit: theme follows prefers-color-scheme
- render() keeps aria-pressed / aria-expanded and the help texts in sync.
```

**Done when:**
- Settings opens and closes on a phone-width window, and looks like `images/05-phone-settings.png`.
- Numbers, Mahjong and Icons look like `images/06/07/08-style-*.png`.
- With Settings open, tapping a cell does nothing and the board is faded.
- Mid-game, New game shows `Start a new game?` like `images/27-phone-confirm.png`; Keep playing changes nothing.
- The moon button switches to `images/02-phone-dark.png` and survives a reload.
- Hard gives 3 adds, disables Hint, and still allows diagonal pairs. Its help text does not mention diagonals.
- Gridiron starts a new 28-tile game of mascots like `images/24-phone-gridiron.png`; outline+solid of the same mascot clear; switching back to Icons starts a new classic game.

---

## Step 9 — Polish pass

```
STEP 9. Compare every screen with the pictures in images/ and list every
difference you can find in spacing, size, colour, font or text. Fix
them. Then check: no horizontal scroll at 320px wide; every button has
a visible focus ring when tabbing; prefers-reduced-motion turns off all
animation; nothing breaks if localStorage throws.
```

**Done when:** you can't tell your build and `reference/number-match.html` apart side by side.

---

## Step 10 — Final check

```
STEP 10. Run tests/logic.test.js (must be 54/54). Then walk through
05-ACCEPTANCE-TESTS.md and report PASS or FAIL for each line, with the
fix for any FAIL.
```
