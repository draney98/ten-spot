# ten-spot

A pair-matching climb: clear the board, get a slightly bigger one, see how high you can go.
Live at https://ten-spot.onrender.com. No build step and no dependencies: the game is plain files,
and the score server uses only what ships with Node 22.

## Run it

- **The game:** open `index.html` in a browser, or serve the folder with any static server.
- **The live site:** `sh tools/build-site.sh` copies only what the game and the tuner need into `public/`. Render runs it on every push.
- **The tests:** `npm test` (same as `node tests/run.js`). One line per test file; every file must say `ok`.
  `tests/browser.test.js` opens the real game in a headless browser and presses the buttons. It needs
  Playwright (`npm install --no-save playwright && npx playwright install chromium`); without it, it says SKIP.
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
| `storage.js`, `sound.js`, `art.js` | Helpers for `app.js`: browser storage and its keys, the sound ticks, and the mascot and wall drawings. |
| `config.js` | Settings shared by the game and the tuner: the score server's address. |
| `server/` | The score server: `scores.js` (SQLite), `http.js` (routes), `limits.js` (posting limits), `migrations.js` (numbered database changes), `index.js` (start-up). |
| `tools/` | `tuner.html` and `tuner-core.js` (configurator and bot), `sim.js` (the bot from the command line). |
| `tests/` | Plain node scripts, one per area. `run.js` runs them all. |
| `design-info/`, `docs/`, `number-match.html` | Earlier design notes and the original single-file version. Kept in the repo, not published. |

## Rules of the house

- A change to the rules goes in `game-logic.js` with a test in `tests/logic.test.js`.
- When the difficulty numbers change, raise `RULES_VERSION` in `game-logic.js` so real-play counts stay apart.
- A database change is a new numbered entry at the end of `server/migrations.js`. Never edit one that has shipped. The server copies the database to `<file>.before-change-<n>` before applying change n.
- Text on the board is drawn with `drawText()` (see `app.js`), not typed into the page, so phones can't select it.
- Deploys happen on push to `main` (see `render.yaml`). A new file the page loads must also be added to `tools/build-site.sh`; a test checks this.
