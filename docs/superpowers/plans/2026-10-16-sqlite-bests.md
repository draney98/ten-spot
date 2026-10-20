# SQLite bests, title, and puzzle codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep each player's Easy, Normal, and Hard best on the existing paid Render instance, in a SQLite file on a 1 GB disk, and let another browser pick them up with a code. Show the game as ten-spot, deal only beatable boards, turn the title red when the current board is not beatable, and show a code that deals that same puzzle again.

**Architecture:** A zero-dependency Node service (`server/`) owns the SQLite file and refuses to lower a best. The static game keeps writing `localStorage` first, then merges with the server through `scores-client.js`. Settings is where a player creates, copies, enters, or forgets a score code, and where they paste a puzzle code. Deals go through a seeded `mulberry32` stream in `game-logic.js` that skips any board `isBeatable` rejects. The heading color and the puzzle code under the board are rendered from that result.

**Tech Stack:** Node 22.22.1, `node:sqlite` `DatabaseSync`, `node:http`, `node:test`-free assert scripts matching `tests/logic.test.js`. No npm packages.

**Spec:** `docs/superpowers/specs/2026-10-16-sqlite-bests-design.md`

## Global Constraints

- Node `22.22.1`. SQLite through `require('node:sqlite').DatabaseSync`. No npm dependencies and no `package.json`.
- Bests stay three integers: `easy`, `normal`, `hard`. Range 0 through 1_000_000_000. Tile style does not get a column.
- The server stores the max. A lower submitted score leaves the stored score as it is.
- `GET` and `PUT` do not create rows. `POST /v1/players` is the only create.
- Code alphabet is `23456789abcdefghjkmnpqrstuvwxyz` (32 characters). 16 characters, displayed `xxxx-xxxx-xxxx-xxxx`, stored without dashes.
- `localStorage` keys stay `numbermatch.best.easy|normal|hard`. New key: `numbermatch.player`. Every `localStorage` call stays inside the existing `try/catch` `store` helper.
- An empty `window.NM_SCORES_API`, a thrown storage error, or a failed request must leave the board playable.
- Do not change pair scoring, penalties, or bonuses in `game-logic.js`. Tasks 7 and 8 may add seeding and the beatable-deal loop. Do not edit `design-info/`.
- The player-facing title string is exactly `ten-spot`. `localStorage` keys stay `numbermatch.*`.
- Do not add a second paid Render service. `render.yaml` names the API service so it updates the instance that already exists; the implementer sets `name` and `plan` to that instance before the blueprint is applied.
- Disk mount `/var/data`, size 1 GB. Database path `/var/data/scores.sqlite` via `SCORES_DB`.
- UI labels are sentence case, font Barlow, using the existing `.set-group`, `.set-title`, `.set-help`, and `.btn` styles.
- Commit messages are one or two sentences focused on why, matching the existing git log. Pass them with a HEREDOC. Do not amend.

## Review Focus

- A `PUT` with a lower score, or a late response from an older game, leaves the higher best in place. Tested in Task 1 (`lower score does not replace a higher one`) and Task 3 (`mergeBests keeps the higher of each difficulty`).
- `GET` and `PUT` with a valid code that was never created return 404 and leave the table empty. Tested in Task 1 (`raiseBests on an unknown code returns null and inserts nothing`) and Task 2 (`PUT unknown code is 404`).
- A negative, fractional, or oversized score, and a code with a digit `0`, are rejected. Tested in Task 1 (`invalid scores throw and change nothing`) and Task 3 (`normalizeCode rejects a short code and a zero`).
- The game still shows a local best when the API origin is empty or the request fails. Tested in Task 3 (`shouldSync is false without an origin or a code`) and Task 4 (the scoreboard `#best` element stays).
- Entering a code from another browser shows the max of the two copies and uploads that max, so the next finish on either browser can beat it. Tested in Task 3 (`mergeBests`) and Task 2 (`PUT raises only the named difficulty`).
- A seed whose first draw is not beatable is not the seed that is shown. The printed code deals the same cells again. Tested in Task 7 (`seekSeed skips a rejected seed` and `the same puzzle code deals the same cells`).
- Classic level 1 stays the fixed 27-digit board and is beatable on Easy, Normal, and Hard. Tested in Task 7 (`classic level 1 is the fixed board on every difficulty`).
- The heading is red only while `isBeatable` is false, and the words "Beatable" and "Not beatable" are gone. Tested in Task 8 (`the title turns red only when the board is not beatable` and `the beatability label is gone`).

---

### Task 1: SQLite score store

**Files:**
- Create: `server/scores.js`
- Create: `tests/scores.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `openScores(path: string) -> DatabaseSync`
  - `createPlayer(db) -> { code: string, easy: 0, normal: 0, hard: 0 }` where `code` is dashed
  - `getPlayer(db, code: string) -> row | null` (`code` dashed in the result)
  - `raiseBests(db, code: string, patch: object) -> row | null` (null when the normalized code is valid and missing; throws `Error` with message `invalid code` or `invalid score`)
  - `normalizeCode(input: string) -> string | null` (16-char raw form, or null)
  - `formatCode(raw16: string) -> string`

- [ ] **Step 1: Write the failing test**

Create `tests/scores.test.js`:

```js
/* Run with:  node tests/scores.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var scores = require('../server/scores.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

test('createPlayer returns zeros and a dashed code from the alphabet', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  assert.deepStrictEqual({ easy: row.easy, normal: row.normal, hard: row.hard }, { easy: 0, normal: 0, hard: 0 });
  assert.match(row.code, /^[23456789abcdefghjkmnpqrstuvwxyz]{4}(-[23456789abcdefghjkmnpqrstuvwxyz]{4}){3}$/);
});

test('getPlayer finds a code typed with dashes and capitals', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  var typed = row.code.slice(0, 4).toUpperCase() + ' ' + row.code.slice(5);
  var found = scores.getPlayer(db, typed);
  assert.strictEqual(found.code, row.code);
});

test('raiseBests on an unknown code returns null and inserts nothing', function () {
  var db = scores.openScores(':memory:');
  var missing = scores.raiseBests(db, '2345-6789-abcd-efgh', { normal: 10 });
  assert.strictEqual(missing, null);
  assert.strictEqual(scores.getPlayer(db, '2345-6789-abcd-efgh'), null);
});

test('lower score does not replace a higher one', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  var raised = scores.raiseBests(db, row.code, { normal: 40, easy: 5 });
  assert.strictEqual(raised.normal, 40);
  assert.strictEqual(raised.easy, 5);
  var again = scores.raiseBests(db, row.code, { normal: 10 });
  assert.strictEqual(again.normal, 40);
  assert.strictEqual(again.easy, 5);
  assert.strictEqual(again.hard, 0);
});

test('invalid scores throw and change nothing', function () {
  var db = scores.openScores(':memory:');
  var row = scores.createPlayer(db);
  assert.throws(function () { scores.raiseBests(db, row.code, { hard: -1 }); }, /invalid score/);
  assert.throws(function () { scores.raiseBests(db, row.code, { hard: 1.5 }); }, /invalid score/);
  assert.throws(function () { scores.raiseBests(db, row.code, { hard: 1000000001 }); }, /invalid score/);
  assert.throws(function () { scores.raiseBests(db, 'not-a-code', { hard: 1 }); }, /invalid code/);
  assert.strictEqual(scores.getPlayer(db, row.code).hard, 0);
});

test('normalizeCode rejects a short code and a zero', function () {
  assert.strictEqual(scores.normalizeCode('2345-6789-abcd-efg'), null);
  assert.strictEqual(scores.normalizeCode('0234-5678-9abc-defg'), null);
  assert.strictEqual(scores.normalizeCode('2345-6789-abcd-efgh'), '23456789abcdefgh');
});

test('a file database survives a second open', function () {
  var file = path.join(os.tmpdir(), 'ten-spot-scores-' + process.pid + '.sqlite');
  try { fs.unlinkSync(file); } catch (e) { /* absent */ }
  var first = scores.openScores(file);
  var row = scores.createPlayer(first);
  scores.raiseBests(first, row.code, { hard: 12 });
  first.close();
  var second = scores.openScores(file);
  assert.strictEqual(scores.getPlayer(second, row.code).hard, 12);
  second.close();
  fs.unlinkSync(file);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scores.test.js`

Expected: FAIL, `Cannot find module '../server/scores.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/scores.js`:

```js
'use strict';
var crypto = require('crypto');
var { DatabaseSync } = require('node:sqlite');

var ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
var FIELDS = ['easy', 'normal', 'hard'];
var MAX_SCORE = 1000000000;

function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  var raw = input.toLowerCase().replace(/[\s-]/g, '');
  if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/.test(raw)) return null;
  return raw;
}

function formatCode(raw) {
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);
}

function rowFrom(record) {
  if (!record) return null;
  return { code: formatCode(record.code), easy: record.easy, normal: record.normal, hard: record.hard };
}

function openScores(path) {
  var db = new DatabaseSync(path, { timeout: 5000 });
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS players (' +
    'code TEXT PRIMARY KEY,' +
    'easy INTEGER NOT NULL DEFAULT 0,' +
    'normal INTEGER NOT NULL DEFAULT 0,' +
    'hard INTEGER NOT NULL DEFAULT 0,' +
    'created_at TEXT NOT NULL,' +
    'updated_at TEXT NOT NULL)'
  );
  return db;
}

function createPlayer(db) {
  var bytes = crypto.randomBytes(16);
  var raw = '';
  for (var i = 0; i < 16; i++) raw += ALPHABET[bytes[i] % 32];
  var now = new Date().toISOString();
  db.prepare('INSERT INTO players (code, easy, normal, hard, created_at, updated_at) VALUES (?, 0, 0, 0, ?, ?)').run(raw, now, now);
  return getPlayer(db, raw);
}

function getPlayer(db, code) {
  var raw = normalizeCode(code);
  if (!raw) return null;
  return rowFrom(db.prepare('SELECT code, easy, normal, hard FROM players WHERE code = ?').get(raw));
}

function raiseBests(db, code, patch) {
  var raw = normalizeCode(code);
  if (!raw) throw new Error('invalid code');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid score');
  var current = db.prepare('SELECT code, easy, normal, hard FROM players WHERE code = ?').get(raw);
  if (!current) return null;
  var next = { easy: current.easy, normal: current.normal, hard: current.hard };
  for (var i = 0; i < FIELDS.length; i++) {
    var key = FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    var n = patch[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_SCORE) throw new Error('invalid score');
    if (n > next[key]) next[key] = n;
  }
  db.prepare('UPDATE players SET easy = ?, normal = ?, hard = ?, updated_at = ? WHERE code = ?')
    .run(next.easy, next.normal, next.hard, new Date().toISOString(), raw);
  return getPlayer(db, raw);
}

module.exports = {
  openScores: openScores,
  createPlayer: createPlayer,
  getPlayer: getPlayer,
  raiseBests: raiseBests,
  normalizeCode: normalizeCode,
  formatCode: formatCode
};
```

Append these lines to `.gitignore`:

```
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/scores.test.js`

Expected: `7 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add server/scores.js tests/scores.test.js .gitignore
git commit -m "$(cat <<'EOF'
Store per-difficulty bests in SQLite so a lower score cannot erase a higher one.

EOF
)"
```

---

### Task 2: HTTP API

**Files:**
- Create: `server/http.js`
- Create: `server/index.js`
- Create: `tests/scores-http.test.js`

**Interfaces:**
- Consumes: `openScores`, `createPlayer`, `getPlayer`, `raiseBests` from `server/scores.js`
- Produces:
  - `createScoresServer({ db, origin }) -> http.Server`
  - `server/index.js` listens on `process.env.PORT` (default `8787`), opens `process.env.SCORES_DB` (default `/var/data/scores.sqlite`), and uses `process.env.SCORES_ORIGIN` (default `''`). If `openScores` throws, print the error and `process.exit(1)`.

- [ ] **Step 1: Write the failing test**

Create `tests/scores-http.test.js`:

```js
/* Run with:  node tests/scores-http.test.js */
'use strict';
var assert = require('assert');
var http = require('http');
var scores = require('../server/scores.js');
var api = require('../server/http.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

function listen(server) {
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () { resolve(server.address().port); });
  });
}

function call(port, method, path, body, origin) {
  return new Promise(function (resolve, reject) {
    var req = http.request({
      host: '127.0.0.1', port: port, method: method, path: path,
      headers: { origin: origin || '', 'content-type': 'application/json' }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        resolve({ status: res.statusCode, json: json, allow: res.headers['access-control-allow-origin'] || '' });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

var db = scores.openScores(':memory:');
var server = api.createScoresServer({ db: db, origin: 'https://ten-spot.example' });

listen(server).then(function (port) {
  return Promise.resolve()
    .then(function () {
      return call(port, 'GET', '/health', null, 'https://ten-spot.example');
    })
    .then(function (res) {
      test('health is ok and echoes the allowed origin', function () {
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.json, { ok: true });
        assert.strictEqual(res.allow, 'https://ten-spot.example');
      });
      return call(port, 'GET', '/health', null, 'https://evil.example');
    })
    .then(function (res) {
      test('a different origin gets no CORS header', function () {
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.allow, '');
      });
      return call(port, 'POST', '/v1/players', {}, 'https://ten-spot.example');
    })
    .then(function (res) {
      test('POST creates a zeroed player', function () {
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.json.easy, 0);
        assert.match(res.json.code, /^[23456789abcdefghjkmnpqrstuvwxyz]{4}(-[23456789abcdefghjkmnpqrstuvwxyz]{4}){3}$/);
      });
      var code = res.json.code;
      return call(port, 'PUT', '/v1/players/' + code, { normal: 30 }, 'https://ten-spot.example')
        .then(function (putRes) { return { code: code, putRes: putRes }; });
    })
    .then(function (ctx) {
      test('PUT raises only the named difficulty', function () {
        assert.strictEqual(ctx.putRes.status, 200);
        assert.strictEqual(ctx.putRes.json.normal, 30);
        assert.strictEqual(ctx.putRes.json.easy, 0);
        assert.strictEqual(ctx.putRes.json.hard, 0);
      });
      return call(port, 'PUT', '/v1/players/2345-6789-abcd-efgh', { easy: 9 }, 'https://ten-spot.example');
    })
    .then(function (res) {
      test('PUT unknown code is 404', function () {
        assert.strictEqual(res.status, 404);
        assert.strictEqual(scores.getPlayer(db, '2345-6789-abcd-efgh'), null);
      });
      return call(port, 'PUT', '/v1/players/0234-5678-9abc-defg', { easy: 9 }, 'https://ten-spot.example');
    })
    .then(function (res) {
      test('PUT invalid code is 400', function () {
        assert.strictEqual(res.status, 400);
      });
      return call(port, 'PUT', '/v1/players/2345-6789-abcd-efgh', 'x'.repeat(1025), 'https://ten-spot.example');
    })
    .then(function (res) {
      test('a body over 1024 bytes is 413', function () {
        assert.strictEqual(res.status, 413);
      });
    });
}).then(function () {
  server.close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}).catch(function (e) {
  console.log('FAIL  harness\n      ' + e.stack);
  process.exit(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scores-http.test.js`

Expected: FAIL, `Cannot find module '../server/http.js'`

- [ ] **Step 3: Write minimal implementation**

Create `server/http.js`:

```js
'use strict';
var http = require('http');
var scores = require('./scores.js');

var MAX_BODY = 1024;

function send(req, res, status, body, origin) {
  var headers = { 'content-type': 'application/json; charset=utf-8' };
  if (origin && req.headers.origin === origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, PUT, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
    headers['vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body == null ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var size = 0;
    var chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function createScoresServer(opts) {
  var db = opts.db;
  var origin = opts.origin || '';
  return http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') return send(req, res, 204, null, origin);
    if (req.method === 'GET' && url.pathname === '/health') return send(req, res, 200, { ok: true }, origin);
    if (req.method === 'POST' && url.pathname === '/v1/players') {
      return send(req, res, 201, scores.createPlayer(db), origin);
    }
    var match = url.pathname.match(/^\/v1\/players\/([^/]+)$/);
    if (!match) return send(req, res, 404, { error: 'not found' }, origin);
    var code = decodeURIComponent(match[1]);
    if (req.method === 'GET') {
      var found = scores.getPlayer(db, code);
      if (!found) return send(req, res, 404, { error: 'unknown code' }, origin);
      return send(req, res, 200, found, origin);
    }
    if (req.method === 'PUT') {
      readBody(req).then(function (text) {
        var patch;
        try { patch = JSON.parse(text || '{}'); }
        catch (e) { return send(req, res, 400, { error: 'invalid json' }, origin); }
        var raised;
        try { raised = scores.raiseBests(db, code, patch); }
        catch (e) { return send(req, res, 400, { error: e.message }, origin); }
        if (!raised) return send(req, res, 404, { error: 'unknown code' }, origin);
        return send(req, res, 200, raised, origin);
      }).catch(function (e) {
        send(req, res, e.status || 400, { error: e.message }, origin);
      });
      return;
    }
    send(req, res, 404, { error: 'not found' }, origin);
  });
}

module.exports = { createScoresServer: createScoresServer };
```

Create `server/index.js`:

```js
'use strict';
var scores = require('./scores.js');
var api = require('./http.js');

var path = process.env.SCORES_DB || '/var/data/scores.sqlite';
var origin = process.env.SCORES_ORIGIN || '';
var port = Number(process.env.PORT) || 8787;

var db;
try {
  db = scores.openScores(path);
} catch (e) {
  console.error('Could not open score database at ' + path);
  console.error(e.message);
  process.exit(1);
}

api.createScoresServer({ db: db, origin: origin }).listen(port, '0.0.0.0', function () {
  console.log('Score server listening on ' + port);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/scores-http.test.js`

Expected: `7 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add server/http.js server/index.js tests/scores-http.test.js
git commit -m "$(cat <<'EOF'
Expose bests over HTTP so another browser can read and raise the same scores.

EOF
)"
```

---

### Task 3: Browser score client

**Files:**
- Create: `scores-client.js`
- Create: `tests/scores-client.test.js`

**Interfaces:**
- Consumes: the HTTP shape from Task 2 (`{ code, easy, normal, hard }`, status codes)
- Produces: `window.NumberMatchScores` / `require('./scores-client.js')` with
  - `normalizeCode(input) -> string | null` (dashed form, or null)
  - `mergeBests(local, remote) -> { easy, normal, hard }` using `Math.max` of finite numbers, treating anything else as 0
  - `getPlayer(base, code, fetchFn) -> Promise<{ ok, status, body, error }>`
  - `putBests(base, code, bests, fetchFn) -> Promise<same>`
  - `createPlayer(base, fetchFn) -> Promise<same>`
  - `shouldSync(api, code) -> boolean` — true only when both strings are non-empty
  - Network failure resolves (does not reject) as `{ ok: false, status: 0, error: 'unreachable' }`
  - Invalid code resolves as `{ ok: false, status: 400, error: 'invalid code' }` and does not call `fetchFn`

- [ ] **Step 1: Write the failing test**

Create `tests/scores-client.test.js`:

```js
/* Run with:  node tests/scores-client.test.js */
'use strict';
var assert = require('assert');
var client = require('../scores-client.js');

var passed = 0, failed = 0, pending = [];
function test(name, fn) {
  var result;
  try { result = fn(); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); return; }
  if (result && typeof result.then === 'function') {
    pending.push(result.then(function () {
      passed++; console.log('PASS  ' + name);
    }, function (e) {
      failed++; console.log('FAIL  ' + name + '\n      ' + e.message);
    }));
  } else {
    passed++; console.log('PASS  ' + name);
  }
}

test('normalizeCode rejects a short code and a zero', function () {
  assert.strictEqual(client.normalizeCode('2345-6789-abcd-efg'), null);
  assert.strictEqual(client.normalizeCode('0234-5678-9abc-defg'), null);
  assert.strictEqual(client.normalizeCode('2345 6789 ABCD efgh'), '2345-6789-abcd-efgh');
});

test('mergeBests keeps the higher of each difficulty', function () {
  assert.deepStrictEqual(
    client.mergeBests({ easy: 10, normal: 3, hard: 0 }, { easy: 4, normal: 9, hard: 2 }),
    { easy: 10, normal: 9, hard: 2 }
  );
  assert.deepStrictEqual(
    client.mergeBests({ easy: 'nope' }, { normal: null, hard: 8 }),
    { easy: 0, normal: 0, hard: 8 }
  );
});

test('getPlayer does not call fetch for an invalid code', function () {
  var called = false;
  return client.getPlayer('https://scores.example', 'nope', function () { called = true; })
    .then(function (res) {
      assert.strictEqual(called, false);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.error, 'invalid code');
    });
});

test('putBests reports unreachable instead of throwing', function () {
  return client.putBests('https://scores.example', '2345-6789-abcd-efgh', { normal: 4 }, function () {
    return Promise.reject(new Error('offline'));
  }).then(function (res) {
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.error, 'unreachable');
  });
});

test('shouldSync is false without an origin or a code', function () {
  assert.strictEqual(client.shouldSync('', '2345-6789-abcd-efgh'), false);
  assert.strictEqual(client.shouldSync('https://scores.example', ''), false);
  assert.strictEqual(client.shouldSync('https://scores.example', '2345-6789-abcd-efgh'), true);
});

test('createPlayer posts and returns the server body', function () {
  return client.createPlayer('https://scores.example', function (url, opts) {
    assert.strictEqual(url, 'https://scores.example/v1/players');
    assert.strictEqual(opts.method, 'POST');
    return Promise.resolve({
      ok: true,
      status: 201,
      json: function () { return Promise.resolve({ code: '2345-6789-abcd-efgh', easy: 0, normal: 0, hard: 0 }); }
    });
  }).then(function (res) {
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.body.code, '2345-6789-abcd-efgh');
  });
});

setTimeout(function () {
  Promise.all(pending).then(function () {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
}, 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/scores-client.test.js`

Expected: FAIL, `Cannot find module '../scores-client.js'`

- [ ] **Step 3: Write minimal implementation**

Create `scores-client.js`:

```js
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NumberMatchScores = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FIELDS = ['easy', 'normal', 'hard'];

  function normalizeCode(input) {
    if (typeof input !== 'string') return null;
    var raw = input.toLowerCase().replace(/[\s-]/g, '');
    if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/.test(raw)) return null;
    return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);
  }

  function num(v) {
    return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : 0;
  }

  function mergeBests(local, remote) {
    var out = {};
    local = local || {};
    remote = remote || {};
    for (var i = 0; i < FIELDS.length; i++) {
      var key = FIELDS[i];
      out[key] = Math.max(num(local[key]), num(remote[key]));
    }
    return out;
  }

  function send(base, method, path, body, fetchFn) {
    var opts = { method: method, headers: { 'content-type': 'application/json' } };
    if (body != null) opts.body = JSON.stringify(body);
    return Promise.resolve().then(function () { return fetchFn(base + path, opts); }).then(function (res) {
      return res.json().then(function (parsed) {
        return { ok: res.ok, status: res.status, body: parsed, error: parsed && parsed.error };
      }, function () {
        return { ok: false, status: res.status, error: 'invalid json' };
      });
    }, function () {
      return { ok: false, status: 0, error: 'unreachable' };
    });
  }

  function invalid() {
    return Promise.resolve({ ok: false, status: 400, error: 'invalid code' });
  }

  function getPlayer(base, code, fetchFn) {
    var id = normalizeCode(code);
    if (!id) return invalid();
    return send(base, 'GET', '/v1/players/' + id, null, fetchFn);
  }

  function putBests(base, code, bests, fetchFn) {
    var id = normalizeCode(code);
    if (!id) return invalid();
    return send(base, 'PUT', '/v1/players/' + id, bests, fetchFn);
  }

  function createPlayer(base, fetchFn) {
    return send(base, 'POST', '/v1/players', {}, fetchFn);
  }

  function shouldSync(api, code) {
    return typeof api === 'string' && api.length > 0 && typeof code === 'string' && code.length > 0;
  }

  return {
    normalizeCode: normalizeCode,
    mergeBests: mergeBests,
    getPlayer: getPlayer,
    putBests: putBests,
    createPlayer: createPlayer,
    shouldSync: shouldSync
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/scores-client.test.js`

Expected: `6 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scores-client.js tests/scores-client.test.js
git commit -m "$(cat <<'EOF'
Merge local and remote bests in the browser without throwing when the server is unreachable.

EOF
)"
```

---

### Task 4: Settings UI and save path

**Files:**
- Modify: `index.html` (settings group after Appearance, before How to play; script tag before `app.js`)
- Modify: `styles.css` (after the `.btn` rules)
- Modify: `app.js` (`loadBest` / `saveBestIfHigher` area, settings wiring, `render` of the score-code controls)
- Create: `tests/score-sync-markup.test.js`

**Interfaces:**
- Consumes: `NumberMatchScores.normalizeCode`, `mergeBests`, `getPlayer`, `putBests`, `createPlayer`
- Produces: settings controls `#scoreCode`, `#btnScoreCreate`, `#btnScoreCopy`, `#btnScoreForget`, `#scoreCodeInput`, `#scoreSyncForm`, `#scoreSyncError`. `window.NM_SCORES_API` read once at startup. Empty string disables network calls.

- [ ] **Step 1: Write the failing test**

Create `tests/score-sync-markup.test.js`:

```js
/* Run with:  node tests/score-sync-markup.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

var html = fs.readFileSync('index.html', 'utf8');
var css = fs.readFileSync('styles.css', 'utf8');
var app = fs.readFileSync('app.js', 'utf8');

test('the page loads the score client and leaves the API unset', function () {
  assert.ok(html.indexOf('scores-client.js') !== -1);
  assert.ok(html.indexOf('window.NM_SCORES_API') !== -1);
  assert.ok(html.indexOf("window.NM_SCORES_API = ''") !== -1);
  var clientAt = html.indexOf('scores-client.js');
  var appAt = html.indexOf('app.js');
  assert.ok(clientAt !== -1 && clientAt < appAt);
});

test('settings has a score code group and the scoreboard still has Best', function () {
  assert.ok(html.indexOf('id="scoreCode"') !== -1);
  assert.ok(html.indexOf('id="btnScoreCreate"') !== -1);
  assert.ok(html.indexOf('id="btnScoreCopy"') !== -1);
  assert.ok(html.indexOf('id="btnScoreForget"') !== -1);
  assert.ok(html.indexOf('id="scoreCodeInput"') !== -1);
  assert.ok(html.indexOf('id="scoreSyncError"') !== -1);
  assert.ok(html.indexOf('id="best"') !== -1);
});

test('styles keep the score code readable on the paper theme', function () {
  assert.ok(css.indexOf('.score-code') !== -1);
  assert.ok(css.indexOf('.score-sync-row') !== -1);
});

test('saveBestIfHigher still writes localStorage and app.js calls putBests', function () {
  assert.ok(app.indexOf('numbermatch.best.') !== -1);
  assert.ok(app.indexOf('numbermatch.player') !== -1);
  assert.ok(app.indexOf('putBests') !== -1);
  assert.ok(app.indexOf('mergeBests') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/score-sync-markup.test.js`

Expected: at least one FAIL naming a missing id or `putBests`

- [ ] **Step 3: Write minimal implementation**

In `index.html`, immediately before `<script src="game-logic.js"></script>` (or whatever the first game script is; it is the script that loads `app.js`'s predecessor), add:

```html
<script>window.NM_SCORES_API = '';</script>
<script src="scores-client.js"></script>
```

`scores-client.js` must appear before `app.js`.

In `index.html`, insert this group after the Appearance `set-group` and before How to play:

```html
    <div class="set-group" id="scoreSync">
      <h2 class="set-title">Score code</h2>
      <p class="set-help">A code keeps your best scores in Easy, Normal, and Hard. Enter it on another browser to use the same bests.</p>
      <p class="score-code" id="scoreCode" hidden></p>
      <div class="score-sync-row">
        <button type="button" class="btn" id="btnScoreCreate">Create a code</button>
        <button type="button" class="btn" id="btnScoreCopy" hidden>Copy</button>
        <button type="button" class="btn" id="btnScoreForget" hidden>Forget this code</button>
      </div>
      <form class="score-sync-row" id="scoreSyncForm">
        <input id="scoreCodeInput" type="text" inputmode="text" autocomplete="off" spellcheck="false" maxlength="19" placeholder="xxxx-xxxx-xxxx-xxxx" aria-label="Score code">
        <button type="submit" class="btn" id="btnScoreUse">Use this code</button>
      </form>
      <p class="set-help" id="scoreSyncError" role="status"></p>
    </div>
```

Append to `styles.css` after the `.btn-primary` rule:

```css
.score-code { font-family: ui-monospace, 'Barlow', monospace; font-size: 16px; font-weight: 700; letter-spacing: 0.04em; margin: 0; }
.score-sync-row { display: flex; gap: 8px; flex-wrap: wrap; }
.score-sync-row input {
  flex: 1 1 160px; min-height: 48px; border: 1.5px solid var(--ink); border-radius: 6px;
  background: transparent; color: var(--ink); font: inherit; padding: 0 12px;
}
.score-sync-row input:focus-visible { outline: 2.5px solid var(--focus); outline-offset: 2px; }
```

In `app.js`, add next to the other keys:

```js
  var KEY_PLAYER = 'numbermatch.player';
  var S = window.NumberMatchScores;
  var SCORES_API = (window.NM_SCORES_API || '').replace(/\/$/, '');
```

Replace `saveBestIfHigher` with:

```js
  function saveBestIfHigher() {
    var d = state.diff, v = state.best[d] || 0;
    if (v > (Number(store.get(KEY_BEST + d)) || 0)) store.set(KEY_BEST + d, String(v));
    pushBests();
  }
  function scoreError(res) {
    if (!res || res.ok) return '';
    if (res.status === 0) return "Couldn't reach the score server.";
    if (res.status === 404) return 'That code was not found.';
    if (res.status === 400) return 'That code is not valid.';
    return "Couldn't reach the score server.";
  }
  function adoptBests(remote) {
    var merged = S.mergeBests(loadBest(), remote);
    Object.keys(merged).forEach(function (k) {
      if (merged[k] > 0) store.set(KEY_BEST + k, String(merged[k]));
    });
    state.best = merged;
    render();
  }
  function pushBests() {
    var code = store.get(KEY_PLAYER);
    if (!S || !S.shouldSync(SCORES_API, code)) return;
    S.putBests(SCORES_API, code, loadBest(), fetch).then(function (res) {
      if (res.ok) adoptBests(res.body);
      else { ui.scoreError = scoreError(res); render(); }
    });
  }
  function pullBests() {
    var code = store.get(KEY_PLAYER);
    if (!S || !S.shouldSync(SCORES_API, code)) return;
    S.getPlayer(SCORES_API, code, fetch).then(function (res) {
      if (!res.ok) { ui.scoreError = scoreError(res); render(); return; }
      var merged = S.mergeBests(loadBest(), res.body);
      adoptBests(merged);
      S.putBests(SCORES_API, code, merged, fetch);
    });
  }
```

Add `scoreError: ''` to the `ui` object.

In `render()`, after the existing settings-button pressed state is set, update the score-code controls:

```js
    var player = store.get(KEY_PLAYER) || '';
    $('scoreCode').textContent = player;
    $('scoreCode').hidden = !player;
    $('btnScoreCreate').hidden = !!player;
    $('btnScoreCopy').hidden = !player;
    $('btnScoreForget').hidden = !player;
    $('scoreSyncError').textContent = ui.scoreError || '';
```

In the wiring section:

```js
  $('btnScoreCreate').addEventListener('click', function () {
    if (!SCORES_API) { ui.scoreError = "Couldn't reach the score server."; render(); return; }
    ui.scoreError = '';
    S.createPlayer(SCORES_API, fetch).then(function (res) {
      if (!res.ok || !res.body || !res.body.code) { ui.scoreError = scoreError(res); render(); return; }
      store.set(KEY_PLAYER, res.body.code);
      pushBests();
      render();
    });
  });
  $('btnScoreCopy').addEventListener('click', function () {
    var code = store.get(KEY_PLAYER) || '';
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code);
  });
  $('btnScoreForget').addEventListener('click', function () {
    store.set(KEY_PLAYER, '');
    try { window.localStorage.removeItem(KEY_PLAYER); } catch (e) { /* ignore */ }
    ui.scoreError = '';
    render();
  });
  $('scoreSyncForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var typed = S.normalizeCode($('scoreCodeInput').value);
    if (!typed) { ui.scoreError = 'That code is not valid.'; render(); return; }
    if (!SCORES_API) { ui.scoreError = "Couldn't reach the score server."; render(); return; }
    ui.scoreError = '';
    S.getPlayer(SCORES_API, typed, fetch).then(function (res) {
      if (!res.ok) { ui.scoreError = scoreError(res); render(); return; }
      store.set(KEY_PLAYER, res.body.code);
      var merged = S.mergeBests(loadBest(), res.body);
      adoptBests(merged);
      S.putBests(SCORES_API, res.body.code, merged, fetch);
      $('scoreCodeInput').value = '';
    });
  });
```

Call `pullBests()` once, after the first `render()` at the bottom of the file, so a returning player merges before they rely on the scoreboard and without resetting the board.

`store.set(KEY_PLAYER, '')` does not remove the key. `Forget this code` must call `localStorage.removeItem`, which the snippet does, and `store.get` then returns null. Guard `pushBests` with `if (!code) return` so an empty string is treated as no code: `if (!code) return`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/score-sync-markup.test.js && node tests/logic.test.js && node tests/scores.test.js && node tests/scores-http.test.js && node tests/scores-client.test.js`

Expected: markup `4 passed, 0 failed`, logic suite still `61 passed, 0 failed`, and the three score suites green.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js tests/score-sync-markup.test.js
git commit -m "$(cat <<'EOF'
Let a player create or enter a score code without losing the local best when the server is down.

EOF
)"
```

---

### Task 5: Render disk and service URL

**Files:**
- Modify: `render.yaml`
- Modify: `index.html` only if the existing service URL is known at implementation time. Leave `window.NM_SCORES_API = ''` when it is not, and say so in the commit message. Do not invent a hostname.

**Interfaces:**
- Consumes: `server/index.js` start command, env names `SCORES_DB`, `SCORES_ORIGIN`, `PORT`, `NODE_VERSION`
- Produces: a blueprint service block the existing paid instance can adopt

- [ ] **Step 1: Write the failing test**

Create `tests/render-scores.test.js`:

```js
/* Run with:  node tests/render-scores.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');
var yaml = fs.readFileSync('render.yaml', 'utf8');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

test('the static site is still published from the repo root', function () {
  assert.ok(yaml.indexOf('runtime: static') !== -1);
  assert.ok(yaml.indexOf('staticPublishPath: .') !== -1);
});

test('the score service uses the paid instance disk and the node server', function () {
  assert.ok(yaml.indexOf('runtime: node') !== -1);
  assert.ok(yaml.indexOf('node server/index.js') !== -1);
  assert.ok(yaml.indexOf('mountPath: /var/data') !== -1);
  assert.ok(yaml.indexOf('sizeGB: 1') !== -1);
  assert.ok(yaml.indexOf('SCORES_DB') !== -1);
  assert.ok(yaml.indexOf('/var/data/scores.sqlite') !== -1);
  assert.ok(yaml.indexOf('SCORES_ORIGIN') !== -1);
  assert.ok(yaml.indexOf('NODE_VERSION') !== -1);
  assert.ok(yaml.indexOf('22.22.1') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/render-scores.test.js`

Expected: FAIL on `runtime: node`

- [ ] **Step 3: Write minimal implementation**

Before editing `name` and `plan`, read the existing paid service in the Render dashboard and copy its service name and plan id (the $7 instance is plan id `0.5c-512mb`). Use those values below. Applying this file with a new name creates a second paid service.

Replace `render.yaml` with:

```yaml
# Render Blueprint
# The static site stays the game. The node service must use the name and plan
# of the paid instance that already exists, so the blueprint updates that
# instance instead of creating another one.
services:
  - type: web
    name: ten-spot
    runtime: static
    branch: main
    buildCommand: "true"
    staticPublishPath: .
    routes:
      - type: rewrite
        source: /*
        destination: /index.html

  - type: web
    name: REPLACE_WITH_EXISTING_SERVICE_NAME
    runtime: node
    plan: 0.5c-512mb
    branch: main
    buildCommand: "true"
    startCommand: node server/index.js
    envVars:
      - key: NODE_VERSION
        value: "22.22.1"
      - key: SCORES_DB
        value: /var/data/scores.sqlite
      - key: SCORES_ORIGIN
        sync: false
    disk:
      name: scores
      mountPath: /var/data
      sizeGB: 1
    healthCheckPath: /health
```

`REPLACE_WITH_EXISTING_SERVICE_NAME` is a placeholder the implementer must replace before any `blueprint apply`. The test in Step 1 does not require a particular name. It does require the disk, the start command, and Node 22.22.1.

Set `SCORES_ORIGIN` in the dashboard to the static site origin, for example `https://ten-spot.onrender.com`, with no path and no trailing slash.

After the service URL is known, set `index.html` to:

```html
<script>window.NM_SCORES_API = 'https://THAT-SERVICE.onrender.com';</script>
```

If the URL is not known in this session, leave the empty string. Sync stays off until that line is filled, and local bests still work.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/render-scores.test.js && node tests/scores.test.js && node tests/scores-http.test.js && node tests/scores-client.test.js && node tests/score-sync-markup.test.js && node tests/logic.test.js`

Expected: all suites print `0 failed`. Logic suite stays at 61 passed.

Manual check once `NM_SCORES_API` points at a running server:

1. Open the game, create a code, finish a level with a score above 0, and confirm Best shows it after reload.
2. Open a second browser profile, enter the code, and confirm Best matches.
3. Finish a lower score in the second browser and confirm Best does not drop.
4. Stop the server, reload the game, and confirm the board still deals and the local Best remains.

- [ ] **Step 5: Commit**

```bash
git add render.yaml index.html tests/render-scores.test.js
git commit -m "$(cat <<'EOF'
Run the score server on the existing paid instance so the SQLite file survives deploys.

EOF
)"
```

If `index.html` was left with an empty API URL, say that in the commit body: the origin is set in the dashboard as `SCORES_ORIGIN`, and the page URL is filled in when the service hostname is known.

---

### Task 6: Rename the title to ten-spot

**Files:**
- Modify: `index.html` (`<title>`, `<h1>`)
- Modify: `number-match.html` (`<title>`, `<h1>` only)
- Create: `tests/title.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: the visible title string `ten-spot` and `id="title"` on the heading in `index.html`. `localStorage` keys are unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/title.test.js`:

```js
/* Run with:  node tests/title.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

var page = fs.readFileSync('index.html', 'utf8');
var bundle = fs.readFileSync('number-match.html', 'utf8');

test('the page title and heading say ten-spot', function () {
  assert.ok(page.indexOf('<title>ten-spot</title>') !== -1);
  assert.ok(page.indexOf('<h1 id="title">ten-spot</h1>') !== -1);
  assert.ok(page.indexOf('Number Match') === -1);
});

test('the bundled page title and heading say ten-spot', function () {
  assert.ok(bundle.indexOf('<title>ten-spot</title>') !== -1);
  assert.ok(bundle.indexOf('>ten-spot</h1>') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/title.test.js`

Expected: FAIL because the title is still `Number Match`

- [ ] **Step 3: Write minimal implementation**

In `index.html`, replace the title and heading:

```html
<title>ten-spot</title>
```

```html
<h1 id="title">ten-spot</h1>
```

In `number-match.html`, replace `<title>Number Match</title>` with `<title>ten-spot</title>` and the `<h1>Number Match</h1>` text with `ten-spot`. Leave the rest of that bundle alone.

Do not rename `numbermatch.best.*`, `numbermatch.theme`, `numbermatch.mode`, or anything under `design-info/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/title.test.js`

Expected: `2 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add index.html number-match.html tests/title.test.js
git commit -m "$(cat <<'EOF'
Call the game ten-spot in the page title and heading.

EOF
)"
```

---

### Task 7: Deal only beatable puzzles, and give each one a code

**Files:**
- Modify: `game-logic.js` (add the helpers below the board builders; export them on the returned object)
- Modify: `tests/logic.test.js` (append the tests at the end of the file, before the pass/fail summary)

**Interfaces:**
- Consumes: `isBeatable`, `levelFields` / `makeBoard`, `copy`
- Produces:
  - `mulberry32(seed: number) -> function` returning a float in `[0, 1)`
  - `nextSeed(seed: number) -> number` (`(seed + 0x9E3779B9) >>> 0`)
  - `randomSeed() -> number` via `crypto.getRandomValues`
  - `seekSeed(seed, build, ok) -> board` tries at most 32 seeds, throws `Error` `no beatable board`
  - `parsePuzzle(text) -> { diff, level, mode, seed } | null`
  - `formatPuzzle({ diff, level, mode, seed }) -> string` like `normal-1-icons-00a1b2c3`
  - `dealPuzzle({ diff, level, best, rules, seed, score, moves, penalties }) -> state` with `state.seed` set to the seed that passed `isBeatable`

Puzzle code grammar: `easy|normal|hard`, then `-`, then a level from 1 to 99, then `-`, then `num|tiles|icons|teams`, then `-`, then exactly 8 lowercase hex digits. `parsePuzzle` lowercases and trims. Anything else returns null.

`dealPuzzle` builds each attempt with a fresh `mulberry32(seed)`, then `levelFields`. It sets `diff`, `seed`, `moves`, `score`, `penalties`, and `best` on that state. Classic level 1 still uses `classicBoard()` (no reshuffle). If that fixed board is not beatable, `seekSeed` throws rather than showing it. A passed attempt is returned immediately, so the stored seed is the one that produced the cells.

- [ ] **Step 1: Write the failing test**

Append to `tests/logic.test.js`, above the existing `console.log` summary:

```js
test('seekSeed skips a rejected seed', function () {
  var seen = [];
  var board = L.seekSeed(1, function (seed) { seen.push(seed); return { seed: seed }; }, function (b) { return b.seed !== 1; });
  assert.deepStrictEqual(seen, [1, L.nextSeed(1)]);
  assert.strictEqual(board.seed, L.nextSeed(1));
});

test('parsePuzzle accepts only a full puzzle code', function () {
  assert.strictEqual(L.parsePuzzle('nope'), null);
  assert.strictEqual(L.parsePuzzle('normal-0-icons-00a1b2c3'), null);
  assert.strictEqual(L.parsePuzzle('normal-1-icons-00a1b2c'), null);
  assert.deepStrictEqual(L.parsePuzzle(' NORMAL-1-ICONS-00A1B2C3 '), {
    diff: 'normal', level: 1, mode: 'icons', seed: 0x00a1b2c3
  });
  assert.strictEqual(L.formatPuzzle({ diff: 'normal', level: 1, mode: 'icons', seed: 0x00a1b2c3 }), 'normal-1-icons-00a1b2c3');
});

test('classic level 1 is the fixed board on every difficulty', function () {
  ['easy', 'normal', 'hard'].forEach(function (diff) {
    var s = L.dealPuzzle({ diff: diff, level: 1, rules: 'classic', seed: 5 });
    assert.deepStrictEqual(s.cells.map(function (c) { return c.v; }), L.classicBoard());
    assert.strictEqual(L.isBeatable(s), true);
    assert.strictEqual(s.seed, 5);
  });
});

test('the same puzzle code deals the same cells', function () {
  var first = L.dealPuzzle({ diff: 'normal', level: 2, rules: 'classic', seed: 1, score: 40, moves: 3, penalties: 2, best: { easy: 0, normal: 9, hard: 0 } });
  assert.strictEqual(L.isBeatable(first), true);
  assert.strictEqual(first.score, 40);
  assert.strictEqual(first.best.normal, 9);
  var again = L.dealPuzzle({ diff: 'normal', level: 2, rules: 'classic', seed: first.seed });
  assert.deepStrictEqual(again.cells.map(function (c) { return c.v; }), first.cells.map(function (c) { return c.v; }));
  assert.strictEqual(again.seed, first.seed);
  var pairs = L.dealPuzzle({ diff: 'hard', level: 1, rules: 'pairs', seed: 9 });
  var tiles = L.dealPuzzle({ diff: 'easy', level: 1, rules: 'mahjong', seed: 9 });
  assert.strictEqual(L.isBeatable(pairs), true);
  assert.strictEqual(L.isBeatable(tiles), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/logic.test.js`

Expected: FAIL because `L.seekSeed` is not a function. The previous 61 tests still pass.

- [ ] **Step 3: Write minimal implementation**

Add these functions in `game-logic.js`. `mulberry32` can sit next to `shuffle`. `dealPuzzle` can sit next to `newGame`.

```js
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), a | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function nextSeed(seed) { return (seed + 0x9E3779B9) >>> 0; }

  function randomSeed() {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0];
  }

  function seekSeed(seed, build, ok) {
    var s = seed >>> 0;
    for (var i = 0; i < 32; i++) {
      var board = build(s);
      if (ok(board)) return board;
      s = nextSeed(s);
    }
    throw new Error('no beatable board');
  }

  function parsePuzzle(text) {
    var m = /^(easy|normal|hard)-(\d+)-(num|tiles|icons|teams)-([0-9a-f]{8})$/.exec(String(text || '').trim().toLowerCase());
    if (!m) return null;
    var level = Number(m[2]);
    if (level < 1 || level > 99) return null;
    return { diff: m[1], level: level, mode: m[3], seed: parseInt(m[4], 16) };
  }

  function formatPuzzle(spec) {
    var hex = (spec.seed >>> 0).toString(16);
    while (hex.length < 8) hex = '0' + hex;
    return spec.diff + '-' + spec.level + '-' + spec.mode + '-' + hex;
  }

  function dealPuzzle(spec) {
    return seekSeed(spec.seed, function (seed) {
      var s = levelFields(spec.diff, spec.level || 1, mulberry32(seed), spec.rules);
      s.diff = spec.diff;
      s.seed = seed;
      s.moves = spec.moves || 0;
      s.score = spec.score || 0;
      s.penalties = spec.penalties || 0;
      s.best = spec.best ? copy(spec.best) : { easy: 0, normal: 0, hard: 0 };
      return s;
    }, isBeatable);
  }
```

`levelFields` is defined later in the file than `shuffle`. Put `dealPuzzle` after `levelFields` and `isBeatable`, and put `mulberry32` next to `shuffle`. Export all seven names on the object returned at the bottom of `game-logic.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/logic.test.js`

Expected: `65 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add game-logic.js tests/logic.test.js
git commit -m "$(cat <<'EOF'
Deal a fresh board only when it is beatable, and keep the seed that produced it.

EOF
)"
```

---

### Task 8: Red title, puzzle code under the board

**Files:**
- Modify: `index.html` (replace the beatability paragraph; add a Puzzle settings group)
- Modify: `styles.css` (replace `.beatability`; add `h1.is-stuck`)
- Modify: `app.js` (deal through `dealPuzzle`; render the code and the title color)
- Modify: `tests/logic.test.js` is unchanged in this task
- Create: `tests/puzzle-ui.test.js`

**Interfaces:**
- Consumes: `dealPuzzle`, `formatPuzzle`, `parsePuzzle`, `randomSeed`, `isBeatable`, `rulesFor`
- Produces: `#puzzleCode` under the board, `#puzzleInput` / `#puzzleForm` in settings, `h1.is-stuck` while `isBeatable` is false

- [ ] **Step 1: Write the failing test**

Create `tests/puzzle-ui.test.js`:

```js
/* Run with:  node tests/puzzle-ui.test.js */
'use strict';
var assert = require('assert');
var fs = require('fs');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + e.message); }
}

var html = fs.readFileSync('index.html', 'utf8');
var css = fs.readFileSync('styles.css', 'utf8');
var app = fs.readFileSync('app.js', 'utf8');

test('the beatability label is gone', function () {
  assert.ok(html.indexOf('id="beatability"') === -1);
  assert.ok(html.indexOf('Beatable') === -1);
  assert.ok(html.indexOf('Not beatable') === -1);
  assert.ok(app.indexOf('beatability') === -1);
  assert.ok(css.indexOf('.beatability') === -1);
});

test('the puzzle code sits under the board and can be entered in settings', function () {
  assert.ok(html.indexOf('id="puzzleCode"') !== -1);
  assert.ok(html.indexOf('id="puzzleInput"') !== -1);
  assert.ok(html.indexOf('id="puzzleForm"') !== -1);
  assert.ok(app.indexOf('formatPuzzle') !== -1);
  assert.ok(app.indexOf('dealPuzzle') !== -1);
  assert.ok(app.indexOf('parsePuzzle') !== -1);
});

test('the title turns red only when the board is not beatable', function () {
  assert.ok(css.indexOf('h1.is-stuck') !== -1);
  assert.ok(css.indexOf('var(--strike)') !== -1);
  assert.ok(app.indexOf('is-stuck') !== -1);
  assert.ok(app.indexOf('isBeatable') !== -1);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/puzzle-ui.test.js`

Expected: FAIL on `id="puzzleCode"` or a remaining `beatability` id

- [ ] **Step 3: Write minimal implementation**

In `index.html`, replace the beatability paragraph with:

```html
    <p class="puzzle-code" id="puzzleCode">normal-1-icons-00000000</p>
```

After the Appearance settings group, add:

```html
    <div class="set-group">
      <h2 class="set-title">Puzzle</h2>
      <p class="set-help">Enter a puzzle code to deal that same board again.</p>
      <form class="score-sync-row" id="puzzleForm">
        <input id="puzzleInput" type="text" autocomplete="off" spellcheck="false" maxlength="32" placeholder="normal-1-icons-00a1b2c3" aria-label="Puzzle code">
        <button type="submit" class="btn" id="btnPuzzle">Play this puzzle</button>
      </form>
      <p class="set-help" id="puzzleError" role="status"></p>
    </div>
```

If Task 4 has not added `.score-sync-row` yet, use that same class here anyway; Task 4 defines it. This task runs after Task 4.

In `styles.css`, delete the `.beatability` rules, including `.sheet.ended .beatability`. Add:

```css
h1.is-stuck { color: var(--strike); }
.puzzle-code {
  margin: 10px 0 0; font-size: 13px; font-weight: 600; text-align: center;
  color: var(--muted); font-variant-numeric: tabular-nums; user-select: text;
}
```

In `app.js`:

Replace the initial `L.newGame('normal', loadBest(), Math.random, rulesFor(savedMode))` with:

```js
  var state = L.dealPuzzle({ diff: 'normal', level: 1, rules: rulesFor(savedMode), best: loadBest(), seed: L.randomSeed() });
```

Replace `onNextLevel` so it keeps score, moves, and penalties, and deals the next level from a new seed:

```js
  function onNextLevel() {
    var carried = { score: state.score, moves: state.moves, penalties: state.penalties || 0, best: state.best, diff: state.diff, rules: state.rules, level: state.level + 1 };
    resetAll();
    state = L.dealPuzzle({
      diff: carried.diff, level: carried.level, rules: carried.rules, best: carried.best,
      seed: L.randomSeed(), score: carried.score, moves: carried.moves, penalties: carried.penalties
    });
    ui.note = levelNote();
    render();
  }
```

Replace `newGame`:

```js
  function newGame(diff) {
    resetAll();
    state = L.dealPuzzle({ diff: diff || state.diff, level: 1, rules: rulesFor(ui.mode), best: state.best, seed: L.randomSeed() });
    render();
  }
```

Add `puzzleError: ''` on `ui`.

In `render()`, delete the beatability block. After the subline is set:

```js
    $('title').classList.toggle('is-stuck', !L.isBeatable(s));
    $('puzzleCode').textContent = L.formatPuzzle({ diff: s.diff, level: s.level, mode: ui.mode, seed: s.seed });
    $('puzzleError').textContent = ui.puzzleError || '';
```

`__nm.load` builds a board directly and may leave `state.seed` unset. After that helper assigns `state`, set `state.seed = state.seed || 0` so `formatPuzzle` still has a number. A loaded test board is not a seeded deal.

Wire the form next to the other settings listeners. Capture `state.best` before `resetAll`, because `resetAll` does not clear `state` but a later edit might:

```js
  function startPuzzle(spec) {
    var best = state.best;
    ui.mode = spec.mode;
    store.set(KEY_MODE, spec.mode);
    ui.settingsOpen = false;
    ui.puzzleError = '';
    resetAll();
    state = L.dealPuzzle({ diff: spec.diff, level: spec.level, rules: rulesFor(spec.mode), best: best, seed: spec.seed });
    render();
  }
  $('puzzleForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var spec = L.parsePuzzle($('puzzleInput').value);
    if (!spec) { ui.puzzleError = 'That puzzle code is not valid.'; render(); return; }
    var go = function () { $('puzzleInput').value = ''; startPuzzle(spec); };
    if (state.moves > 0 || state.level > 1 || state.score > 0 || (state.penalties || 0) > 0) {
      confirmReset('Play this puzzle?', 'This starts that puzzle over from its first deal.', 'Play this puzzle', go);
    } else go();
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/puzzle-ui.test.js && node tests/title.test.js && node tests/logic.test.js`

Expected: puzzle UI `3 passed, 0 failed`, title `2 passed, 0 failed`, logic `65 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add index.html styles.css app.js tests/puzzle-ui.test.js
git commit -m "$(cat <<'EOF'
Show a puzzle code under the board and turn the title red when that board is not beatable.

EOF
)"
```
