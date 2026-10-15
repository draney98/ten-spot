# Number Match — functional specification

Everything here is already implemented in `reference/src/game-logic.js` (rules) and `reference/src/app.js` (screen). Where this document and the code disagree, **the code wins**. Tell the human about any disagreement you find.

---

## 1. Words used in this document

| Word | Meaning |
|---|---|
| **cell** | One square on the board. It has an `id` (unique number), a value `v` (1–9) and `done` (true once cleared). |
| **board** | A flat list of cells, read left to right, top to bottom, **9 per row**. Row = `Math.floor(index / 9)`, column = `index % 9`. The last row may be shorter than 9. |
| **active** | A cell that is not done. |
| **cleared / done** | A cell the player has removed. It stays in place (faded, with a red strike) until its whole row is cleared. |
| **pair** | Two cells the player taps, one after the other. |
| **level** | One board. Clearing every cell finishes the level. |
| **difficulty** | Easy, Normal or Hard. Chosen in Settings. Changes the limits and the points (§8). |
| **tile style** | Numbers, Mahjong, Icons or **Gridiron** (internal mode names `num`, `tiles`, `icons`, `teams`). Numbers and Icons only change how the cells LOOK (§12). **Mahjong** is its own rule set with circle tiles plus winds and dragons (§16). **Gridiron** is a rule set with football mascots instead of numbers (§15). |
| **rule set** | `classic` (Numbers, Icons), `mahjong` (Mahjong), `pairs` (Gridiron). Use `rulesFor(mode)`: `teams → 'pairs'`, `tiles → 'mahjong'`, anything else `'classic'`. |
| **rules** | `'classic'` (numbers 1–9: equal or adds to 10) or `'pairs'` (Gridiron: same mascot). Stored on the game state. |

---

## 2. The starting board

### Level 1 (always the same)

Take the numbers 1 to 19, **skip 10** (it would need a zero), and write out their digits in order. This gives 27 values, which is 3 rows of 9:

```
row 0:  1 2 3 4 5 6 7 8 9
row 1:  1 1 1 2 1 3 1 4 1        <- digits of 11, 12, 13, 14, and the first "1" of 15
row 2:  5 1 6 1 7 1 8 1 9        <- the "5" of 15, then 16, 17, 18, 19
```

Cell ids are 1..27 in that order.

### Level 2 and later (random)

- Board size: **level 2 → 36**, **level 3 → 44**, **level 4 and up → 54** numbers.
- Values are dealt in pairs, `size / 2` times:
  - pick `a` = random integer 1..9;
  - push `a`, then push either `a` again or `10 − a` (50/50).
- Then shuffle the whole list (Fisher–Yates).
- Cell ids restart at 1 for each new level.

Dealing in pairs guarantees the values *could* all be paired. Positions are random, so a board can still be unwinnable. That is fine; the player has Add numbers.

---

## 3. Which two cells can be paired?

A pair is cleared only when **both** of these are true.

### 3a. The values match

`a === b` **or** `a + b === 10`.

- Matching pairs: 1-1, 1-9, 2-2, 2-8, 3-3, 3-7, 4-4, 4-6, 5-5, 6-6, 7-7, 8-8, 9-9.
- Not a match: for example 2-3, 4-5, 9-2.

### 3b. The positions connect

Call the two indexes `a < b`. They connect if **any** one of these three rules is true:

| # | Rule | How to check |
|---|---|---|
| 1 | **Reading order** | Every cell with index strictly between `a` and `b` is done. This covers side-by-side neighbours, gaps of cleared cells in a row, AND wrapping from the end of one row to the start of the next. |
| 2 | **Column** | Same column (`a % 9 === b % 9`), and every cell between them in that column is done. Touching rows count automatically, because there is nothing between them. |
| 3 | **Diagonal** (every difficulty) | `abs(column difference) === row difference` (an exact 45° line), and every cell between them on that diagonal is done. |

Anything else is **not** connected. For example, a knight-move shape (1 row down, 2 columns across) never connects.

See `images/18-pairing-rules.png`. The exact code (copy it, don't rewrite it):

```js
function canLink(cells, a, b, diag) {
  if (a > b) { var t = a; a = b; b = t; }
  if (a === b) return false;
  var clear = true;                                      // rule 1: reading order
  for (var k = a + 1; k < b; k++) if (!cells[k].done) { clear = false; break; }
  if (clear) return true;
  var ra = Math.floor(a / 9), ca = a % 9, rb = Math.floor(b / 9), cb = b % 9;
  var dr = rb - ra, dc = cb - ca;
  if (dr <= 0) return false;                             // same row, rule 1 failed
  if (dc === 0 || (diag && Math.abs(dc) === dr)) {       // rule 2 or rule 3
    var step = Math.sign(dc);
    for (var s = 1; s < dr; s++) if (!cells[(ra + s) * 9 + ca + s * step].done) return false;
    return true;
  }
  return false;
}
```

### Worked examples on the level-1 board

| Tap | Result | Why |
|---|---|---|
| id 1 (top-left "1"), then id 10 ("1" directly below) | **Clears** | equal; column neighbours |
| id 1 ("1"), then id 9 ("9", end of row 0) | Fails: "Not reachable…" | sum 10, but 7 active cells between in reading order |
| id 9 ("9"), then id 10 ("1", start of row 1) | **Clears** | sum 10; reading order: nothing between (wrap) |
| id 2 ("2"), then id 3 ("3") | Fails: "Pick two equal numbers…" | neighbours, but 2 + 3 ≠ 10 |
| id 1 ("1"), then id 11 ("1", row 1 col 1) | **Clears** (on every difficulty) | diagonal neighbours |

---

## 4. Tapping cells (selection)

| Situation | What happens |
|---|---|
| Tap a done cell | Nothing. |
| Game not in "playing" status (end card showing) | Nothing. |
| Nothing selected, tap an active cell | It becomes **selected** (a yellow highlighter swipe behind it). Any hint highlight disappears. |
| Tap the selected cell again | It is **deselected**. |
| Something selected, tap a different cell, and it is a valid pair | **Match**: both cells become done, points are added (§5), and the match animation plays (`03-DESIGN.md` §7). Selection clears. |
| Something selected, tap a different cell, and it is NOT valid | The **new** cell becomes selected and plays a short **shake**. The combo resets to 0. The status line explains why (§13). |

---

## 5. Scoring

`mult = difficultyMult × (1 + 0.2 × (level − 1))`

| | Formula |
|---|---|
| **Points for a pair** | `round((10 + min((combo − 1) × 2, 20) + styleBonus + 50 × rowsCleared) × mult)` |
| **styleBonus** | `10` when both tiles are drawn the same way (two outlines, or two shaded/solid tiles), else `0`. See "Shading" below. |
| **Mixed pair** (legal match, but one outline and one shaded) | It **still clears**, but instead of points it costs half its worth: `penalty = round(pairPoints(combo, 0, mult, false) / 2)` and the score changes by `rowBonus − penalty` (a row it empties still pays `round(50 × rows × mult)`). The score never drops below 0. It counts toward the combo like any clear. Undo gives the points back (it undoes the whole move). Winds and dragons are never mixed. Use `mixedShade(x, y, rules)`. |
| **Mismatch penalty** | Picking two tiles whose **values don't match** subtracts `round(P / 2)`, where P is what that pair would have scored as a real match: `pairPoints(combo + 1, 0, mult, sameShade)` (no row bonus). The score never drops below 0 (take `min(score, penalty)`). A pair that matches but isn't reachable costs nothing. The combo still resets. |
| **combo** | Pairs cleared in a row: 1 for the first pair, 2 for the next, and so on. **Resets to 0** on a bad pick, Add, or Hint. Undo restores the combo from before the undone move. |
| **Undo and penalties** | Undo restores the score from before the undone move **minus every mismatch penalty paid since then** (floored at 0). `state.penalties` is a running total for the game; snapshots store it too. So you can't undo your way out of a penalty. |
| **rowsCleared** | How many rows became fully done because of THIS pair. A short last row counts as a row. |
| **Level bonus** (added when the board is cleared) | `round(mult × (100 × addsLeft + 25 × hintsLeft + 200 × level))`. Unlimited hints count as 0. |

### Shading

Every style draws each tile either as an **outline** or **shaded** (solid):

| Rules | Outline | Shaded |
|---|---|---|
| classic (Numbers, Icons) | 1–5 | 6–9 |
| mahjong circle tiles | 1–5 (rings) | 6–9 (discs) |
| mahjong winds and dragons | — no shading, never a style bonus | — |
| pairs (Gridiron) | odd values | even values |

`shadeOf(v, rules)` returns `'outline'`, `'solid'` or `null`; `sameShade(x, y, rules)` is true when both are the same non-null shade. In classic rules this means **identical** pairs (1+1, 9+9, 5+5) get the bonus and complement pairs (1+9) don't.

### Worked examples (Normal, level 1, so mult = 1.5)

- A mixed pair (1 + 9) as the 2nd pair of a streak: worth `round((10 + 2) × 1.5)` = 18, so it clears and costs **−9**
- A mixed pair that empties a row with combo 1 (the `__nm.load([3,7])` test): `75 − round(15 / 2)` = **+67**
- First pair, two outlines (1 + 1, the opening move): `round((10 + 10) × 1.5)` = **30**
- Mismatch 2 + 3 (both outlines) as the 2nd pick of a streak of 1: would score `round((10 + 2 + 10) × 1.5)` = 33, so **−17**
- Second pair in a row: `round((10 + 2) × 1.5)` = **18**
- 11th pair in a row (the combo bonus caps at +20): `round(30 × 1.5)` = **45**
- A pair that also empties a row, with combo 1: `round((10 + 50) × 1.5)` = **90**
- Clear level 1 with 5 adds and 3 hints left: `round(1.5 × (500 + 75 + 200))` = `round(1162.5)` = **1163**

`Math.round` rounds .5 up, so 1162.5 becomes 1163.

---

## 6. Add numbers

When the player taps **Add numbers**:

1. Take every **active** cell, in board order.
2. Append a copy of each value to the end of the board, as new cells with new ids (`nextId`, `nextId + 1`, …).
3. Remove any fully-done rows (§9).
4. `addsLeft −= 1`, `moves += 1`, `total += number added`, `combo = 0`, selection clears.
5. New cells play the "born" grow-in animation.
6. Then check for game over (§10). Using your last add can leave you stuck.

The button is disabled when `addsLeft === 0`, when no active cells remain, or when the level has ended.

---

## 7. Undo and Hint

**Undo**

- Each pair and each Add saves a snapshot first: `cells, nextId, moves, cleared, total, score, combo, addsLeft, penalties`. At most 200 are kept.
- Undo restores the last snapshot and spends 1 undo. Unlimited (`Infinity`) stays unlimited.
- Undoing an Add gives that add back, because `addsLeft` is in the snapshot.
- Undo does **not** give back undos or hints.
- Undo is not allowed after the level is cleared.
- Undo IS allowed from the Game-over card (the "Undo last move" button), which returns to playing.
- History is wiped at the start of every level.

**Hint**

- Finds the first legal pair: scan `i` from the start, and for each `i` scan `j > i`.
- Spends 1 hint and resets the combo.
- The two cells get pulsing pencil circles for 2.2 seconds.
- If no pair exists, no hint is spent and the status line says so (§13).
- Disabled on Hard (0 hints) and when the count reaches 0.

---

## 8. Difficulty

| | Easy | Normal (default) | Hard |
|---|---|---|---|
| Adds per level at level 1 | 8 | 5 | 3 |
| Minimum adds per level | 4 | 2 | 1 |
| Hints per level | unlimited | 3 | 0 |
| Undos per level | unlimited | 5 | 1 |
| Diagonal pairs | yes | yes | yes |
| Points multiplier | ×1 | ×1.5 | ×2.5 |

**Adds per level** = `max(minAdds, adds − floor((level − 1) / 2))`

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8+ |
|---|---|---|---|---|---|---|---|---|
| Easy | 8 | 8 | 7 | 7 | 6 | 6 | 5 | 5, then 4 from level 9 |
| Normal | 5 | 5 | 4 | 4 | 3 | 3 | 2 | 2 |
| Hard | 3 | 3 | 2 | 2 | 1 | 1 | 1 | 1 |

Hints and undos reset to the difficulty's numbers at the start of every level. **Changing difficulty starts a brand new game** at level 1 with score 0.

---

## 9. Collapsing finished rows

A row whose cells are ALL done is removed from the board. Everything below moves up. This happens:

- **900 ms after a match** (so the animation finishes first). Skip it if another action happened in between, or if the level just ended (keep the crossed-out board visible under the end card).
- **Immediately** inside Add numbers (§6).

Removing rows changes indexes, and with them which cells are now neighbours. That is intended; it is how the game normally plays.

---

## 10. End of a level

After **every** pair and every Add, check in this order:

1. **Board clear**: `total − cleared === 0`.
   - status becomes `'clear'`.
   - Add the level bonus (§5) to the score.
   - Show the "Board clear!" card.
2. **Game over**: `addsLeft === 0` **and** no legal pair exists anywhere.
   - status becomes `'lose'`.
   - Show the "Game over" card.
3. Otherwise status stays `'playing'`.

**Next level** (button on the clear card):

- deals level + 1 (§2);
- keeps `score`, `moves`, `best` and `diff`;
- resets `addsLeft`, `hintsLeft`, `undosLeft`, history, combo, `cleared` and `total`.

**Play again** (button on the game-over card) and **New game** (header button): a new game on the current difficulty, level 1, score 0.

See `images/22-game-flow.png`.

---

## 11. Best score

- One best score per difficulty: `best = { easy, normal, hard }`.
- Updated whenever a level ends (clear OR game over), if the score is higher.
- When it is beaten, set `newBest = true` (the end card says "New best score!").
- Saved to `localStorage` key `numbermatch.best.easy` (or `.normal` / `.hard`) as a plain number string.

---

## 12. Settings and saved preferences

| Setting | Values | Default | localStorage key |
|---|---|---|---|
| Difficulty | easy / normal / hard | normal | not saved (resets to Normal on reload) |
| Tile style | num / tiles / icons / teams (shown as "Numbers / Mahjong / Icons / Gridiron") | icons | `numbermatch.mode` |
| Theme | light / dark | the device's `prefers-color-scheme` | `numbermatch.theme` |

### While Settings is open, the board is switched off

When the Settings panel (or the confirm dialog, §17) is open, set `inert = true` and add class `is-off` to `#board`, `#actions` (the bottom bar) and `#note`. The player cannot tap cells, Undo, Hint or Add until Settings closes. Remove both when it closes. On desktop, Settings starts **closed** like on the phone; the Settings button is always visible.

**Every** `localStorage` read and write must be wrapped in `try { } catch (e) { }`. Private browsing can throw, and the game must still work without storage.

---

## 13. Every on-screen text string (use these exactly)

| Where | Text |
|---|---|
| Title | `Number Match` |
| Subline (under the title) | `Level {level} on {Easy\|Normal\|Hard}, points ×{mult rounded to 1 decimal}`, e.g. `Level 1 on Normal, points ×1.5` |
| Status line, default | `Select two {pick} to clear them.` where pick is `numbers` / `tiles` (Mahjong) / `icons` / `tiles` (Gridiron) |
| Bad pick, values wrong | Numbers: `Pick two equal numbers, or two that add up to 10.` · Mahjong: `Pick two identical tiles, or circle tiles that add up to 10.` · Icons: `Pick two identical icons, or an icon and its mirror image.` · Gridiron: `Pick two tiles with the same mascot.` |
| Bad pick, values wrong, with a penalty | the message above, then ` −{penalty} points.` (`1 point.`), e.g. `Pick two identical icons, or an icon and its mirror image. −17 points.` Only when the penalty is above 0. |
| Bad pick, position wrong | `Not reachable: only crossed-out cells can sit between a pair.` |
| Match that empties a row | `Row cleared! +{round(50 × rows × mult)}` |
| Mixed pair, no row | `Outline + shaded: cleared, but −{penalty} points.` (`1 point.`), or `Outline + shaded: cleared, but no points.` when the score was already 0 |
| Mixed pair that empties a row | `Row cleared! +{rowBonus}, but outline + shaded −{penalty} points.` (or `… scores nothing.` when the penalty is 0) |
| Match with a style bonus (and no row) | `Both outlines: style bonus +{round(10 × mult)}.` or `Both shaded: style bonus +{…}.` |
| Match with combo ≥ 3 (no row, no style bonus) | `{combo} in a row!` |
| Any other match | (default text) |
| Add button, main label | `Add {noun}` where noun is `numbers` / `tiles` (Mahjong) / `icons` / `mascots` (Gridiron). It changes the moment the style changes. |
| After Add | `Added {n} {noun}. {k} adds left this level.` (`1 add left`), or `Added {n} {noun}. That was your last add for this level.` (same noun as the button) |
| Hint, no pair, adds left | `No pairs left. Try Add {noun}.` |
| Hint, no pair, no adds | `No pairs left.` |
| Start of level 2+ | `Level {n}: {total} numbers, {adds} adds.` (`1 add.`). Gridiron: `Level {n}: {total} tiles, {mascots} mascots, {adds} adds.` Mahjong: `Level {n}: {total} tiles, {k} kinds of winds and dragons, {adds} adds.` |
| Score tag (red pencil, after the word Score) | `+{gain}`, `combo ×{combo}`, or both joined with `, ` (e.g. `+18, combo ×2`). After a mismatch or a mixed pair that lost points it shows `−{points lost}` (a real minus sign `−`). Hidden when empty. The gain or penalty clears 1.4 s later. The combo shows while combo > 1. |
| Add button, 2nd line | `{addsLeft} of {addsForThisLevel} left this level` |
| Undo / Hint small text | `{count} left`, or `∞ left` when unlimited |
| Scoreboard | Three columns: `Score`, `Best`, `Cleared`. Cleared is `floor(cleared / total × 100)` + `%`, e.g. `7%` (floor, so 100% only when the board is empty). There is no Moves or Left column and no progress text; the progress bar stays. |
| Clear card | kicker `Level {n} cleared` · title `Board clear!` · big `+{bonus}` · detail `Bonus for unused adds and hints, plus a level bonus. Score {score}.` · line `New best score!` or `Next: level {n+1} with {adds} adds` · button `Next level` |
| Game-over card | kicker `Out of moves on level {n}` · title `Game over` · big `{score}` · detail `No adds left and no pairs to clear. You reached level {n}.` · line `New best score!` or `Best: {best}` · buttons `Play again` and (only if an undo is available) `Undo last move` |
| Difficulty help | The parts joined with `, `: `{adds} adds per level, dropping to {minAdds}`, then `{hints} hints` / `no hints` / `unlimited hints`, then `{undos} undos` / `1 undo` / `unlimited undo`, then `×{mult} points, +20% each level`. Then `. Changing difficulty starts a new game.` **Do not mention diagonals**: they are allowed on every difficulty, so they are not a difference. |
| Style help | Numbers: `Digits in boxes: 1 to 5 in an outlined box, 6 to 9 in a shaded box.` · Mahjong: `Mahjong tiles. Circle tiles match like numbers: the same count, or two that add up to 10. 1 to 5 are rings, 6 to 9 are shaded discs. Winds and dragons only match an identical tile. Level 1 has 2 kinds of winds and dragons; each level adds one, up to all 7. Switching to or from Mahjong starts a new game.` · Icons: `Identical icons match, and so do mirror images. The lower value is an outline and its partner is filled in. The small number is the value.` · Gridiron: `Any two tiles with the same mascot match: an outline and its solid twin, or two the same. Level 1 has 5 mascots; each level adds one, up to 8 (longhorn, paw, helmet, shamrock, football, then bone, feather, claws). Switching to or from Gridiron starts a new game.` |
| Cell aria-label (Mahjong) | `{n} circles` (`1 circle`), or `East wind` / `South wind` / `West wind` / `North wind` / `Red dragon` / `Green dragon` / `White dragon`, plus `, selected` / `, cleared` |
| Confirm dialog | See §17 |
| Cell aria-label (Gridiron) | `{Mascot name}, outline` or `{Mascot name}, solid`, plus `, selected` / `, cleared` |
| How to play | `Clear two numbers that are equal or add up to 10. They must touch, or have only crossed-out cells between them, including across the end of a row. Stuck? Add numbers copies everything left onto the bottom, but each level allows only a few. Clear the board to reach the next level: bigger boards, fewer adds, more points. Pairs drawn the same way (two outlines, or two shaded) earn a style bonus. An outline with a shaded tile still clears, but costs half its points. Picking two tiles that don’t match costs half the points they would have scored.` |

Format numbers with thousands separators: `1,448`, i.e. `toLocaleString('en-US')`.

---

## 14. Game state (owned by game-logic.js)

```js
{
  diff: 'normal',           // 'easy' | 'normal' | 'hard'
  rules: 'classic',         // 'classic' | 'pairs' (Gridiron) | 'mahjong'
  level: 1,
  cells: [{ id: 1, v: 1, done: false }, ...],
  nextId: 28,
  selected: null,           // cell id or null
  moves: 0, score: 0, combo: 0,
  penalties: 0,             // points lost to mismatches this game; Undo never refunds them
  cleared: 0, total: 27,
  addsLeft: 5, hintsLeft: 3, undosLeft: 5,    // may be Infinity
  history: [],              // snapshots for Undo
  status: 'playing',        // 'playing' | 'clear' | 'lose'
  bonus: 0, final: 0,
  best: { easy: 0, normal: 0, hard: 0 },
  newBest: false
}
```

### Actions

Every action returns `{ state, event }` and never modifies its input.

| Call | event (or null if nothing happened) |
|---|---|
| `select(state, id)` | `{type:'select', id}` · `{type:'deselect', id}` · `{type:'bad', id, reason:'value'\|'path', penalty}` · `{type:'match', ids:[a,b], indexes, gain, combo, rowsCleared:[rowNums], rowBonus, mixed, penalty, styleBonus, shade:'outline'\|'solid'\|null, status, newBest}` |
| `addNumbers(state)` | `{type:'add', ids:[newIds], count, addsLeft, status, newBest}` |
| `undo(state)` | `{type:'undo'}` |
| `hint(state)` | `{type:'hint', ids:[a,b]}` · `{type:'nohint'}`. Shows a pair that is NOT mixed when one exists (`findPair(cells, diag, rules, true)`) |
| `nextLevel(state, rng)` | `{type:'level', level}` |
| `compactBoard(state)` | returns a state directly (no event) |
| `newGame(diff, best, rng, rules)` | returns a state directly. `rules` is `'classic'` (default), `'pairs'` or `'mahjong'` |

### Screen-only state (owned by app.js, never affects the rules)

`mode` (tile style), `dark`, `settingsOpen`, `confirm` (null, or `{yes, returnFocus}` while the confirm dialog is open), `flash[]`, `bad[]`, `hint[]`, `born[]` (cell ids currently animating), `gain`, `note` (status-line text).

---

## 15. Gridiron mode (rules `'pairs'`)

Gridiron replaces the numbers with football-mascot tiles. Everything else stays the same: pairing positions (§3b), selection, scoring, adds, undo, hint, collapsing rows, levels, end cards, difficulty and best score.

### Values and mascots

- Cell values are 1 to 16. A value's mascot is `Math.ceil(v / 2)` (1–8).
- **Odd value = outline** tile; **even value = solid** tile (its "inverse twin").
- **Match rule:** two tiles match when they show the **same mascot**, either an outline and its solid twin, or two identical tiles. This mirrors classic, where "equal" and "adds to 10" both match.
- There are no numbers on the tiles and no corner digits. The player matches by shape. Each mascot also has its own coloured-pencil ink as a second cue.

| Mascot # | Name | Values (outline / solid) | First appears | Colour family |
|---|---|---|---|---|
| 1 | Longhorn | 1 / 2 | level 1 | h3 orange |
| 2 | Tiger paw | 3 / 4 | level 1 | h5 purple |
| 3 | Trojan helmet | 5 / 6 | level 1 | h4 red |
| 4 | Shamrock | 7 / 8 | level 1 | h2 green |
| 5 | Football | 9 / 10 | level 1 | h8 lamp black |
| 6 | Bone | 11 / 12 | level 2 | h7 ochre |
| 7 | Feather | 13 / 14 | level 3 | h6 teal |
| 8 | Claw marks | 15 / 16 | level 4 | h1 blue |

### Boards

- **Mascots in play** = `min(8, 4 + level)`: 5 on level 1, 6 on level 2, 7 on level 3, 8 from level 4 on.
- **Board size**: level 1 = **28**, then 36, 44, 54 (as in classic, except level 1 is 28 so it can be dealt in pairs).
- **Dealing**: `size / 2` times, pick a random mascot from those in play and push **two** tiles of it, each randomly outline or solid. Then shuffle (Fisher–Yates). Every mascot therefore appears an even number of times.
- Every level is random. There is no fixed "classic" first board in Gridiron.

### Switching

- Numbers and Icons are just looks for the classic rules, so switching between them keeps the current game.
- Switching **to or from Gridiron starts a new game** (level 1, score 0) with the other rule set, after the confirm dialog (§17) if a game is in progress.
- The chosen style is saved (`numbermatch.mode = 'teams'`), so a reload starts in Gridiron.
- Best scores are shared per difficulty across all rule sets.

### Code

`game-logic.js` already does all of this. Call `newGame(diff, best, rng, 'pairs')`; every other action reads `state.rules`. Helpers: `mascots(level)`, `mascotOf(v)`, `isSolid(v)`, `MAX_MASCOTS`.


---

## 16. Mahjong mode (rules `'mahjong'`)

Mahjong uses mahjong tiles to give more kinds of tile than the nine numbers. Pairing positions, selection, scoring, adds, undo, hint, collapsing rows, levels and end cards are unchanged.

### Values

| Value | Tile | Matches |
|---|---|---|
| 1–9 | **Circle** tiles (1 to 9 circles) | Classic rule: the same count, or two that add up to 10 |
| 11 | East wind 東 | only another 11 |
| 12 | South wind 南 | only another 12 |
| 13 | West wind 西 | only another 13 |
| 14 | North wind 北 | only another 14 |
| 15 | Red dragon 中 | only another 15 |
| 16 | Green dragon 發 | only another 16 |
| 17 | White dragon (an empty blue frame) | only another 17 |

Value 10 is never used. A circle tile never matches a wind or dragon.

```js
if (rules === 'mahjong' && (isHonour(x) || isHonour(y))) return x === y;   // otherwise the classic test
```

### Boards

- **Kinds of winds and dragons in play** = `min(7, level + 1)`: 2 on level 1 (East, South), 3 on level 2, … all 7 from level 6.
- **Board size**: level 1 = **28**, then 36, 44, 54.
- **Dealing**: `size / 2` times: with chance 0.35 push two copies of a random wind/dragon in play; otherwise pick a circle value `a` (1–9) and push `a` and either `a` or `10 − a`. Then shuffle (Fisher–Yates).
- Every level is random, including level 1.

### Switching

Switching to or from Mahjong starts a new game, after the confirm dialog (§17) if a game is in progress. `numbermatch.mode = 'tiles'` reloads into Mahjong.

### Code

`game-logic.js` already does this. Call `newGame(diff, best, rng, 'mahjong')`. Helpers: `isHonour(v)`, `honoursInPlay(level)`, `mahjongBoard(level, rng)`, `MAX_HONOURS`.

---

## 17. Confirming anything that resets the board

Three actions throw away the current game: **New game** (header button), **changing difficulty**, and **changing to a tile style with a different rule set** (classic ↔ Mahjong ↔ Gridiron). Before doing any of them:

1. If **no game is in progress**, just do it. "In progress" means `status === 'playing'` and any of: `moves > 0`, `level > 1`, `score > 0`, `penalties > 0`, or a hint has been used (`hintsLeft < LEVELS[diff].hints` when hints are limited). So a fresh board, or the clear / game-over card, never asks. **Play again** and **Next level** on the end cards never ask.
2. Otherwise open the confirm dialog (`images/27-phone-confirm.png`):

| Action | Title | Text (then a space and the progress line) | Yes button |
|---|---|---|---|
| New game | `Start a new game?` | `A new game starts over at level 1.` | `Start new game` |
| Difficulty | `Switch to {Easy\|Normal\|Hard}?` | `Changing difficulty starts a new game.` | `Switch to {label}` |
| Tile style | `Switch to {Mahjong\|Gridiron\|Numbers\|Icons}?` | `{Name} uses different tiles, so switching starts a new game.` | `Switch to {Name}` |

Progress line: `You’re on level {level} with {score} points.` (`1 point`). The No button always says `Keep playing`.

- `Keep playing`, **Escape** and a tap on the backdrop all cancel: nothing changes.
- The Yes button runs the action **and closes Settings**.
- When it opens, focus `#confirmNo`. Tab and Shift+Tab stay inside the dialog. When it closes, focus goes back to the button that opened it.
- While open, the board is switched off exactly like with Settings (§12).
- Switching between Numbers and Icons (same rules) never asks; it keeps the board.
