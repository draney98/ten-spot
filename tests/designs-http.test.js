/* Run with:  node tests/designs-http.test.js
   The Daily, Saga and admin routes end to end, over real HTTP. */
'use strict';
var assert = require('assert');
var http = require('http');
var scores = require('../server/scores.js');
var api = require('../server/http.js');

var ORIGIN = 'https://ten-spot.example';
var KEY = 'admin-key-for-tests-0123456789';
var passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}
function call(port, method, path, body, key) {
  return new Promise(function (resolve, reject) {
    var headers = { origin: ORIGIN, 'content-type': 'application/json' };
    if (key) headers.authorization = 'Bearer ' + key;
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: path, headers: headers }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8'), json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        resolve({ status: res.statusCode, json: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}
async function start(opts) {
  var server = api.createScoresServer(Object.assign({ db: scores.openScores(':memory:'), origin: ORIGIN }, opts));
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  return { server: server, port: server.address().port };
}
var BOARD = { v: 1, name: 'Warm-up', level: 12, cols: 5, cells: [1, 1, 3, 3, -1, 0, 5, 5, 7, 7], adds: 1, par: 0 };

(async function () {
  var off = await start({});
  var t = 5000000;
  var on = await start({ adminKey: KEY, now: function () { return t; }, limits: { adminfail: { max: 3, windowMs: 60000 } } });

  await test('without an admin key set, admin routes are off; reading still works', async function () {
    assert.strictEqual((await call(off.port, 'GET', '/v1/admin', null, KEY)).status, 503);
    assert.strictEqual((await call(off.port, 'PUT', '/v1/admin/boards/daily/2026-11-18/1', BOARD, KEY)).status, 503);
    var day = await call(off.port, 'GET', '/v1/daily/2026-11-18');
    assert.strictEqual(day.status, 200);
    assert.deepStrictEqual(day.json, { date: '2026-11-18', boards: [null, null, null] });
    assert.deepStrictEqual((await call(off.port, 'GET', '/v1/saga')).json, { chapters: [] });
  });

  await test('a short admin key is not used', async function () {
    var short = await start({ adminKey: 'too-short' });
    assert.strictEqual((await call(short.port, 'GET', '/v1/admin', null, 'too-short')).status, 503);
    short.server.close();
  });

  await test('the right key is the admin; a wrong key or none gets 401, and guessing is cut off', async function () {
    assert.deepStrictEqual((await call(on.port, 'GET', '/v1/admin', null, KEY)).json, { admin: true });
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin', null, null)).status, 401);
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin', null, KEY + 'x')).status, 401);
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin', null, 'wrong')).status, 401);
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin', null, 'wrong')).status, 429, 'the fourth wrong key in a minute');
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin', null, KEY)).status, 200, 'the right key still works');
    t += 61000;   // a minute later the wrong-key count starts again
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin', null, 'wrong')).status, 401);
  });

  await test('the admin saves a Daily board; everyone reads it', async function () {
    var r = await call(on.port, 'PUT', '/v1/admin/boards/daily/2026-11-18/2', BOARD, KEY);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { slot: 'daily/2026-11-18/2', saved: true });
    var day = await call(on.port, 'GET', '/v1/daily/2026-11-18');
    assert.deepStrictEqual(day.json.boards[0], null);
    assert.deepStrictEqual(day.json.boards[1], BOARD);
    assert.strictEqual(day.headers['access-control-allow-origin'], ORIGIN);
  });

  await test('a bad slot, a bad board or a board that cannot be cleared is refused with a reason', async function () {
    var r = await call(on.port, 'PUT', '/v1/admin/boards/daily/2026-11-18/4', BOARD, KEY);
    assert.strictEqual(r.status, 400); assert.ok(/unknown slot/.test(r.json.error));
    r = await call(on.port, 'PUT', '/v1/admin/boards/saga/1/1', { v: 1, level: 1, cols: 5, cells: [1, 3] }, KEY);
    assert.strictEqual(r.status, 400); assert.ok(/even number/.test(r.json.error));
    r = await call(on.port, 'PUT', '/v1/admin/boards/saga/1/1', { v: 1, level: 12, cols: 5, cells: [1, 3, 1, 3], adds: 0 }, KEY);
    assert.strictEqual(r.status, 400); assert.ok(/cannot be cleared/.test(r.json.error));
    assert.strictEqual((await call(on.port, 'PUT', '/v1/admin/boards/saga/1/1', BOARD, null)).status, 401, 'not without the key');
    assert.strictEqual((await call(on.port, 'GET', '/v1/daily/someday')).status, 400);
  });

  await test('Saga lists chapters and boards in order; the admin lists and removes', async function () {
    for (var slot of ['saga/1/2', 'saga/1/1', 'saga/2/1']) {
      assert.strictEqual((await call(on.port, 'PUT', '/v1/admin/boards/' + slot, Object.assign({}, BOARD, { name: slot }), KEY)).status, 200);
    }
    var saga = (await call(on.port, 'GET', '/v1/saga')).json;
    assert.deepStrictEqual(saga.chapters.map(function (c) { return [c.chapter, c.boards.map(function (b) { return b.design.name; })]; }),
      [[1, ['saga/1/1', 'saga/1/2']], [2, ['saga/2/1']]]);
    var list = (await call(on.port, 'GET', '/v1/admin/boards?prefix=saga/1/', null, KEY)).json;
    assert.deepStrictEqual(list.designs.map(function (d) { return d.slot; }), ['saga/1/1', 'saga/1/2']);
    assert.strictEqual((await call(on.port, 'GET', '/v1/admin/boards?prefix=saga/1/', null, null)).status, 401);
    var gone = await call(on.port, 'DELETE', '/v1/admin/boards/saga/1/2', null, KEY);
    assert.deepStrictEqual(gone.json, { slot: 'saga/1/2', removed: true });
    assert.strictEqual((await call(on.port, 'GET', '/v1/saga')).json.chapters[0].boards.length, 1);
  });

  off.server.close(); on.server.close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
