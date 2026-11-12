# ten-spot

A pair-matching climb: clear the board, get a slightly bigger one, see how high you can go.
Live at https://ten-spot.onrender.com. No build step and no dependencies: the game is plain files,
and the score server uses only what ships with Node 22.

## Run it

- **The game:** open `index.html` in a browser, or serve the folder with any static server.
- **The tests:** `npm test` (same as `node tests/run.js`). One line per test file; every file must say `ok`.
- **The score server:** `SCORES_DB=./scores.sqlite node server/index.js` (port 8787, or `PORT`).
- **The bot:** `node tools/sim.js 100` plays 100 runs and prints how far they get.
- **The configurator:** open `tools/tuner.html` to try other difficulty numbers with the bot.

## Where things are

| File | What it holds |
| --- | --- |
| `game-logic.js` | All the rules, as pure functions: `state` in, `{ state, event }` out. No page code. The difficulty numbers are the `RAMP`, `TOOLS` and `TUNE` tables near the top. |
| `app.js` | The page: draws the state, plays sounds and animations, handles taps, saves the game. It never changes game fields itself; it asks `game-logic.js`. |
| `save.js` | Turns a game into text for browser storage and back. |
| `scores-client.js` | Talks to the score server: bests, shared boards, run ends. |
| `index.html`, `styles.css` | The page and its looks. |
| `server/` | The score server: `scores.js` (SQLite), `http.js` (routes), `index.js` (start-up). |
| `tools/` | `tuner.html` and `tuner-core.js` (configurator and bot), `sim.js` (the bot from the command line). |
| `tests/` | Plain node scripts, one per area. `run.js` runs them all. |
| `design-info/`, `docs/`, `number-match.html` | Earlier design notes and the original single-file version. Not used by the live game. |

## Rules of the house

- A change to the rules goes in `game-logic.js` with a test in `tests/logic.test.js`.
- When the difficulty numbers change, raise `RULES_VERSION` in `game-logic.js` so real-play counts stay apart.
- Text on the board is drawn with `drawText()` (see `app.js`), not typed into the page, so phones can't select it.
- Deploys happen on push to `main` (see `render.yaml`).
