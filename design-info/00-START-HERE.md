# Number Match — build package

This folder has everything an AI coding assistant needs to rebuild the Number Match game exactly. It contains:

- a working reference app,
- a detailed spec,
- pictures of every screen,
- tests that prove the rules are right.

---

## The 30-second version

1. Open `reference/number-match.html` in any browser. **This is the finished game.** It works. It is the target.
2. Give your AI the contents of `01-MASTER-PROMPT.md` **plus the files listed in it**.
3. Feed it `04-BUILD-STEPS.md` **one step at a time**. Check each step against the pictures before moving on.
4. When it says it's done, run through `05-ACCEPTANCE-TESTS.md` yourself.

**The easiest path if your AI is weak:** if all you need is the game running on the web, you don't need the AI to write anything. Just host `reference/number-match.html` as-is (one file, no build step, no dependencies). Use the AI only for changes.

---

## What's in the folder

| Path | What it is | Give it to the AI? |
|---|---|---|
| `00-START-HERE.md` | This file (for you, the human) | No |
| `01-MASTER-PROMPT.md` | The prompt to paste first | **Yes, first** |
| `02-SPEC.md` | Every rule, number, formula and on-screen message | **Yes** |
| `03-DESIGN.md` | Colours, fonts, sizes, layout, animations, picture index | **Yes** |
| `04-BUILD-STEPS.md` | 10 small steps, each with a "done when" check | **Yes, one step per message** |
| `05-ACCEPTANCE-TESTS.md` | Click-by-click test script with expected results | For you, and for the AI at the end |
| `06-COMMON-MISTAKES.md` | Bugs weak AIs usually write, and how to spot them | **Yes** |
| `07-PORTING-NOTES.md` | How to rebuild in React / Vue / Svelte / Flutter / Swift instead of plain HTML | Only if not plain HTML |
| `reference/number-match.html` | **The finished game in one file.** Open it in a browser. | Yes |
| `reference/src/game-logic.js` | All game rules. Pure functions, no screen code. | **Yes — tell it to copy this file unchanged** |
| `reference/src/app.js` | Screen code: drawing, clicks, animations, saving | Yes |
| `reference/src/styles.css` | All styling, light + dark | Yes |
| `reference/src/index.html` | Page markup | Yes |
| `reference/tests/logic.test.js` | 54 automated rule tests. Run: `node reference/tests/logic.test.js` | Yes |
| `reference/build-single-file.py` | Re-creates `number-match.html` from `src/` | Optional |
| `images/` | 32 pictures: screenshots of the real app plus diagrams | **Yes, as many as it accepts** |

---

## The most important pictures (if the AI can only take a few)

1. `images/01-phone-light.png` — what the game looks like
2. `images/18-pairing-rules.png` — the core rule, visually
3. `images/20-phone-layout-annotated.png` — every part of the screen, numbered
4. `images/16-cell-artwork-light.png` — what every tile looks like in each style
5. `images/19-match-animation-timeline.png` — the match animation, frame by frame
6. `images/02-phone-dark.png` — dark mode
7. `images/11-desktop-light.png` — wide-screen layout
8. `images/25-gridiron-mascots-light.png` and `images/24-phone-gridiron.png` — the Gridiron (football mascot) mode

---

## How to keep a weak AI on track

- **One step per message.** Never paste all of `04-BUILD-STEPS.md` at once.
- **Make it copy, not invent.** The strongest instruction you have is "copy `game-logic.js` exactly, do not rewrite it". Most bugs in this game come from re-deriving the pairing rule.
- **Check against pictures after every step.** If it doesn't match the screenshot, say exactly what is different ("the cells are not square", "the Chalkboard background should be #18211d").
- **Run the tests.** If it touches `game-logic.js`, run `node reference/tests/logic.test.js`. All 54 must pass.
- **If it goes off the rails, reset.** Start a fresh chat with the master prompt and resume from the last good step. Long chats make weak AIs worse.
