# Common mistakes — check your code for every one of these

Weak AIs get these wrong over and over. Each one is listed with its symptom and its fix.

## Rules

1. **Rewriting the pairing rule.** Symptom: wrap-around or "across cleared cells" pairs fail, or knight-move pairs succeed. **Fix:** use `canLink` from `game-logic.js` unchanged.
2. **Only checking direct neighbours.** The rule is "nothing *active* between them", not "touching". Two `5`s with three cleared cells between them in a row must pair.
3. **Forgetting the wrap.** The last cell of a row and the first cell of the next row are neighbours in reading order. So are any two cells with only cleared cells between them in reading order, even across several rows.
4. **Blocking diagonals on Hard.** Diagonals are allowed on **every** difficulty (`diag: true` everywhere). Hard is harder only through fewer adds, no hints, 1 undo and the bigger multiplier.
5. **Allowing any diagonal.** Only exact 45° lines (`|col diff| === row diff`) count, and only when every cell between them on that line is cleared.
6. **Wrong level-1 board.** It is the digits of 1–19 *without 10*: `1 2 3 4 5 6 7 8 9 / 1 1 1 2 1 3 1 4 1 / 5 1 6 1 7 1 8 1 9`. Not 1–9 three times, and not random.
7. **Add numbers copying cleared cells too.** Only **active** values are copied, in order.
8. **Collapsing rows too early.** Removing rows instantly kills the animation and confuses players. Wait 900 ms after a match. Skip it entirely if another action happened in between, or if the level ended.
9. **Undo refunding the undo.** Undo *costs* one undo. It restores score, combo and adds from before the move, but never undos or hints.
10. **Combo not resetting.** A bad pick, Add numbers or Hint sets combo to 0.
11. **Points rounding.** Use `Math.round` on the final product (`(10 + comboBonus + 50 × rows) × mult`), not on each piece.
12. **Infinity shown as "Infinity".** Show `∞`. Remember `Infinity - 1 === Infinity`, so unlimited stays unlimited automatically.
13. **Best score saved on every move, or never.** Save it when a level ends (clear or game over), only if it is higher.

## Screen code

14. **Rebuilding every cell on each render** (`grid.innerHTML = cells.map(...)`). Symptom: animations restart or never play, the board flickers, the hint pulse jumps. **Fix:** reuse buttons keyed by cell id (`syncBoard`).
15. **Moving a cell element unnecessarily.** `insertBefore` on an element already in the right place restarts its CSS animation. Only move it if `grid.children[i] !== el`.
16. **Measuring effect positions after the board changes.** Call `spawnFx` *before* anything is re-rendered or collapsed.
17. **Animating with JavaScript (`setInterval`, `requestAnimationFrame`).** All motion is CSS keyframes. JS only adds and removes elements and classes, plus a few `setTimeout`s.
18. **Stale timers.** A 900 ms collapse firing after the player pressed Undo or New game corrupts the board. Every delayed callback must check the `tok` counter, and New game / Next level / Undo must clear all timers.
19. **Clickable `<div>`s.** Every control is a `<button type="button">`.
20. **`localStorage` without `try/catch`.** It throws in some private modes, and the whole game dies. Wrap every call.
21. **Not re-showing the end card's animation.** Toggle the `hidden` attribute (hidden → shown) so the fade-in restarts.

## Layout and look

22. **Desktop-first CSS.** Write the phone layout as the default. Add the desktop layout inside `@media (min-width: 960px)` only.
23. **Non-square cells.** Use `aspect-ratio: 1` and `grid-template-columns: repeat(9, minmax(0, 1fr))`. Plain `1fr` lets long content stretch columns.
24. **Horizontal scroll on small phones.** Check at 320px. The usual cause is fixed pixel widths, or a `min-width` on grid children (fix with `minmax(0, 1fr)` and `min-width: 0`).
25. **Bottom bar not sticky, or covering the board.** It is `position: sticky; bottom: 0` inside the page flow, not `position: fixed`.
26. **Hard-coded colours.** Every colour comes from a CSS variable, so dark mode works by toggling one class on `<html>`.
27. **CSS rule order.** `.c-sel` and `.c-done` must come *after* `.c-tile` in the stylesheet, or tile colours override the selected and cleared looks.
28. **Wrong font or "app template" styling.** Barlow for everything, numbers included. No monospace numbers, no ALL-CAPS labels, no pill badges, no rounded cards with drop shadows, no pastel tile backgrounds, no "A · B · C" strings. The look is a paper engineering pad (see `03-DESIGN.md`).
29. **Emoji as icons.** Use the inline SVGs from `index.html` and the icon paths from `03-DESIGN.md` §6.
30. **Changing the text.** Use the exact strings in `02-SPEC.md` §13.

## Gridiron mode

31. **Using the classic rule in Gridiron.** Gridiron matches by **mascot** (`Math.ceil(v/2)`), never by "equal or adds to 10". Values 1 and 9 are different mascots (longhorn vs football).
32. **Only allowing outline + solid.** Two identical tiles of the same mascot also match.
33. **Not restarting when switching rule sets.** Switching to or from Gridiron or Mahjong must start a new game (after the confirm dialog). Switching between Numbers and Icons must NOT.
34. **Showing numbers on Gridiron tiles.** No digits, no corner numbers. Shape plus colour only.
35. **Solid football or feather with no detail.** Draw the `knock` path (laces / feather spine) on the solid version in the tile's background colour (`.knock` class), or the solid looks like a plain blob.
36. **Dealing an odd level-1 board.** Gridiron level 1 is 28 tiles, dealt in pairs, so every mascot appears an even number of times.
37. **All 8 mascots on level 1.** Level 1 uses only mascots 1–5. Add one per level, up to 8.

## Mahjong, confirmations, Settings

38. **Letting a circle tile match a wind or dragon, or two different winds.** Winds and dragons (11–17) match only an identical tile. Circles (1–9) use the classic rule.
39. **Value 10 in Mahjong.** Never dealt. Honours start at 11.
40. **Resetting without asking.** New game, difficulty and rule-set changes go through the confirm dialog when a game is in progress (`02-SPEC.md` §17). But **don't** ask on a fresh board or from the end cards: that just nags.
41. **Board still tappable behind Settings.** Set `inert` (not just `pointer-events`) on `#board`, `#actions` and `#note` while Settings or the dialog is open, so keyboard users can't reach them either.
42. **Hard-coding "Add numbers".** The label follows the style: Add numbers / tiles / icons / mascots, and the status messages use the same word.
43. **Half-filled icons.** Every icon is `fill-opacity` 0 or 1. No 0.16 tints, no half circles.
44. **Cleared cells too dark.** `--done` is `#ccd5c0` (Paper) / `#34443b` (Chalkboard) and the strike is at opacity .4.
45. **Listing diagonals as a difficulty difference.** They are allowed everywhere; leave them out of the difficulty help.

## Style bonus, penalties, scoreboard

46. **Style bonus on the wrong pairs.** It's about how the tiles are DRAWN (outline vs shaded), not their values: classic 1–5 outline / 6–9 shaded; Gridiron odd outline / even solid; winds and dragons never. Use `shadeOf` / `sameShade` from `game-logic.js`.
47. **Penalising unreachable pairs.** A matching pair blocked by live cells costs nothing (and nothing clears).
48. **Negative scores.** The penalty is capped at the current score.
49. **Undo refunding penalties.** Undo subtracts the penalties paid since the snapshot (`state.penalties`).
50. **Keeping Moves and Left on screen.** The scoreboard is Score, Best, Cleared %. Use `Math.floor` so it can't show 100% with tiles left.
51. **Plain graphite Numbers.** Numbers are coloured by pair family and boxed (outline for 1–5, filled for 6–9) like the other styles.
52. **New game without asking after a hint, a mismatch or an Add.** Any of those makes the game "in progress" (`02-SPEC.md` §17).
53. **Not clearing a mixed pair.** Outline + shaded is still a legal match: the tiles clear, only the score goes down.
54. **Paying the full pair points AND the penalty, or dropping the row bonus.** A mixed pair scores `rowBonus − round(pairWorth / 2)`, nothing else.
55. **Same yellow line for a mixed pair.** Add `fx-pen` to the effect group: red line, pink highlighter, `−N` label.
