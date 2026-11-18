# ten-spot

A pair-matching climb: clear the board, get a slightly bigger one, see how high you can go.
Live at https://ten-spot.onrender.com. No build step and no dependencies: the game is plain files,
and the score server uses only what ships with Node 22.

## Run it

- **The game:** open `index.html` in a browser, or serve the folder with any static server.
- **The live site:** `sh tools/build-site.sh` copies only what the game and the tools (tuner, tile sheet, board designer) need into `public/`. Render runs it on every push.
- **The tests:** `npm test` (same as `node tests/run.js`). One line per test file; every file must say `ok`.
  `tests/browser.test.js` opens the real game in a headless browser and presses the buttons. It needs
  Playwright (`npm install --no-save playwright && npx playwright install chromium`); without it, it says SKIP.
- **The score server:** `SCORES_DB=./scores.sqlite node server/index.js` (port 8787, or `PORT`).
  Add `TENSPOT_ADMIN_KEY=<24 or more characters>` to turn on the admin routes that save Daily and Saga boards.
- **The bot:** `node tools/sim.js 100` plays 100 runs and prints how far they get.
- **The configurator:** open `tools/tuner.html` to try other difficulty numbers with the bot.
- **Daily and Saga boards:** open `tools/designer.html` on the live site. Enter the admin key, pick a day and board (or a Saga chapter and board), deal, press Measure to see how the bots do and set par, then Save. Daily boards are dealt 3 × 3, 5 × 5 and 7 × 7 with an empty centre.
- **New tile art:** open `tools/tiles.html` on the live site (it needs a web address, not a file). *Combine* puts a pixel set's 16 tiles on one square sheet for an image AI, with a prompt to start from; *Split* cuts the picture that comes back into 16 PNGs and downloads them as a zip that unzips into `art/<set>/`.

## Where things are

| File | What it holds |
| --- | --- |
| `game-logic.js` | All the rules, as pure functions: `state` in, `{ state, event }` out. No page code. The difficulty numbers are the `RAMP`, `TOOLS` and `TUNE` tables near the top. |
| `app.js` | The page: draws the state, plays sounds and animations, handles taps, saves the game. It never changes game fields itself; it asks `game-logic.js`. |
| `save.js` | Turns a game into text for browser storage and back. |
| `scores-client.js` | Talks to the score server: bests, shared boards, run ends. |
| `index.html`, `styles.css` | The page and its looks. |
| `storage.js`, `sound.js`, `art.js` | Helpers for `app.js`: browser storage and its keys, the sound ticks, and the tile drawings (the Gridiron mascots, the Pixel characters, the Arcade pick-ups as pixel rows, the walls; Arcade HD points at its pictures). |
| `art/` | Tile pictures, one folder per set (`art/arcade-hd/heart-day.png`, `heart-night.png`, …), 96 × 96 PNG. To change a tile, replace its PNG with another of the same name and size. Published as-is by `tools/build-site.sh`. |
| `account.js` | The Account group in Settings: making an account, adding a device with a code, the recovery link, signing out. |
| `config.js` | Settings shared by the game and the tuner: the score server's address. |
| `server/` | The score server: `scores.js` (SQLite), `http.js` (routes), `limits.js` (posting limits), `migrations.js` (numbered database changes), `accounts.js` (accounts: device keys, link codes, recovery), `designs.js` (Daily and Saga boards, and the admin key), `index.js` (start-up). |
| `tools/` | `tuner.html` and `tuner-core.js` (configurator, bots and board measuring), `tiles.html` and `tiles-core.js` (tile sheet tool), `designer.html` (board designer for Daily and Saga), `sim.js` (the bot from the command line). |
| `tests/` | Plain node scripts, one per area. `run.js` runs them all. |
| `design-info/`, `docs/`, `number-match.html` | Earlier design notes and the original single-file version. Kept in the repo, not published. |

## Daily and Saga boards

A board for Daily or Saga is written down rather than dealt: the format (cells, width 3 to 9, level, buttons, Adds par)
is described in `game-logic.js` under "DESIGNED BOARDS", with `checkDesign`, `stateFromDesign` and `designFromState`.
The score server keeps them by slot: `daily/YYYY-MM-DD/1` to `/3` (three a day, easiest first) and
`saga/<chapter>/<1..10>` (chapters of ten).

| Route | Who | What |
| --- | --- | --- |
| `GET /v1/daily/<date>` | anyone | `{ date, boards: [b1, b2, b3] }`, `null` where a board isn't set |
| `GET /v1/saga` | anyone | every chapter and its boards, in order |
| `GET /v1/admin` | admin | `{ admin: true }`: checks the key |
| `GET /v1/admin/boards?prefix=daily/2026-11` | admin | the boards saved under a prefix |
| `PUT /v1/admin/boards/<slot>` | admin | save a board (checked: format, and it can be cleared with its own Adds) |
| `DELETE /v1/admin/boards/<slot>` | admin | remove a board |

The admin sends `Authorization: Bearer <key>`, where the key is `TENSPOT_ADMIN_KEY` on the score service
(Render → ten-spot-scores → Environment). Without it, or with a key under 24 characters, the admin routes
answer 503. Ten wrong keys a minute from one address and it must wait.

## Rules of the house

- A change to the rules goes in `game-logic.js` with a test in `tests/logic.test.js`.
- When the difficulty numbers change, raise `RULES_VERSION` in `game-logic.js` so real-play counts stay apart.
- A database change is a new numbered entry at the end of `server/migrations.js`. Never edit one that has shipped. The server copies the database to `<file>.before-change-<n>` before applying change n.
- Text on the board is drawn with `drawText()` (see `app.js`), not typed into the page, so phones can't select it.
- Deploys happen on push to `main` (see `render.yaml`). A new file the page loads must also be added to `tools/build-site.sh`; a test checks this.
