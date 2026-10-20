# Cross-browser bests on SQLite

## Purpose

A player's best score for Easy, Normal, and Hard follows them to another browser. The score file lives on the paid Render web service they already have, on a 1 GB persistent disk. The game stays a static site.

## What is stored

One row per player. Columns: `easy`, `normal`, `hard`. Integers, minimum 0, maximum 1_000_000_000. Tile style (Numbers, Icons, Mahjong, Gridiron) does not get its own best.

A best is written when a level ends (clear or game over), and only when the new final score is higher than the stored one. The server applies that rule itself: a lower number never replaces a higher one.

## Identity

There is no account, email, or password. Creating a code makes a row and returns a code. The code is the secret.

Format: 16 characters from `23456789abcdefghjkmnpqrstuvwxyz`, shown as `xxxx-xxxx-xxxx-xxxx`. Stored without dashes. Input may contain dashes, spaces, and any letter case. Any other shape is invalid.

Knowing a code lets you read and raise that row. `GET` and `PUT` for an unknown code do not create a row.

## API

Base URL is the paid web service. JSON only. No cookies.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/health` | `200 { "ok": true }` |
| `POST` | `/v1/players` | `201` and the new row, including the dashed `code` and three zeros |
| `GET` | `/v1/players/:code` | `200` row, or `404` if the code is unknown or invalid |
| `PUT` | `/v1/players/:code` | Body may include any of `easy`, `normal`, `hard`. `200` the row after taking the max of each field. `404` if the code is valid and unknown. `400` if the code is invalid, the body is not a JSON object, or a present score is not an integer in range. Absent fields stay unchanged. |

`Access-Control-Allow-Origin` is set only when the request `Origin` header equals the `SCORES_ORIGIN` environment variable. Other origins get the JSON with no CORS header, so a browser on another site cannot read it.

Request bodies larger than 1024 bytes are rejected with `413`.

## Client

`localStorage` remains the copy the game can read while playing:

- `numbermatch.best.easy`, `numbermatch.best.normal`, `numbermatch.best.hard`
- `numbermatch.player` — the code, or absent

`window.NM_SCORES_API` is the service origin, with no trailing slash. An empty string turns sync off. The game still plays.

Settings gains a "Score code" group:

- No code: "Create a code". On success, store the code and upload the current local bests.
- A code: show it, "Copy", "Forget this code", and a field to type a different code.
- "Use this code" loads that row, keeps the higher value of each difficulty, writes that back to the server and to `localStorage`, and shows it on the scoreboard.
- "Forget this code" removes `numbermatch.player` only. Local bests stay. The server row stays.

On load, if a code and an API origin are set, fetch the row and merge with `Math.max` per difficulty. If the local numbers were higher, upload the merge. Then show the merged bests. This must not reset the current board.

`saveBestIfHigher` still writes `localStorage` first, then uploads `{ easy, normal, hard }` from that local copy when a code is set.

## Failure

A storage exception, a network error, or a non-OK response must not throw into the game. The board, theme, and local bests keep working. Settings shows one of:

- "Couldn't reach the score server."
- "That code was not found."
- "That code is not valid."

## Deploy

The existing static site stays. The existing paid web service runs `node server/index.js`. It does not get a second paid instance.

- Node `22.22.1` (`node:sqlite`, `DatabaseSync`). No npm dependencies.
- Disk: 1 GB, mount path `/var/data`.
- `SCORES_DB=/var/data/scores.sqlite`
- `SCORES_ORIGIN` is the static site's origin, scheme plus host, no path.
- `window.NM_SCORES_API` in `index.html` is that service's origin.

If the database path cannot be opened, the process exits 1. It must not fall back to an in-memory database.

## Title

The player-facing title is `ten-spot` in the document title and the page heading, in `index.html` and `number-match.html`. `localStorage` keys stay `numbermatch.*`. `design-info/` stays as the build package.

## Stuck boards and puzzle codes

A dealt board is beatable before it is shown. `isBeatable` is the check (legal matches and remaining adds, no hints, no mismatches). Classic level 1 is the fixed 27-digit board; it is not reshuffled. Every other deal draws from a `mulberry32` stream and, if that board is not beatable, draws again from the next seed. At most 32 seeds are tried. The seed stored on the state is the one whose board passed.

The heading stays the normal ink color while the current board is beatable, including when it has just been cleared. When `isBeatable` is false (stuck mid-level, or lost), the heading is red (`--strike`). There is no "Beatable" or "Not beatable" text.

Under the board, where that label was, the game shows a puzzle code:

`{difficulty}-{level}-{mode}-{8 hex digits}`

Example: `normal-1-icons-00a1b2c3`.

`difficulty` is `easy`, `normal`, or `hard`. `level` is an integer from 1 to 99. `mode` is `num`, `tiles`, `icons`, or `teams`. The hex is the uint32 seed that produced this deal. Dealing that code again produces the same cell values, difficulty, level, tile style, and starting adds, hints, and undos. Score, moves, and penalties start at 0. Settings has a "Play this puzzle" field that accepts the code. A game already in progress asks for confirmation first, using the existing confirm dialog.

## Out of scope

Public leaderboards, accounts, deleting a server row from the UI, bests per tile style, and editing `design-info/`.
