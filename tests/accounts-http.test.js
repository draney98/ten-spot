/* Run with:  node tests/accounts-http.test.js
   The account routes end to end, over real HTTP. */
'use strict';
var assert = require('assert');
var http = require('http');
var scores = require('../server/scores.js');
var api = require('../server/http.js');

var ORIGIN = 'https://ten-spot.example';
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

(async function () {
  var t = 9000000;
  var db = scores.openScores(':memory:');
  var server = api.createScoresServer({ db: db, origin: ORIGIN, now: function () { return t; },
    limits: { signin: { max: 4, windowMs: 60000 } } });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var port = server.address().port;
  var ana, link, ipad;

  await test('the page may send a device key and use PATCH and DELETE', async function () {
    var r = await call(port, 'OPTIONS', '/v1/me');
    assert.strictEqual(r.status, 204);
    assert.ok(/authorization/.test(r.headers['access-control-allow-headers']));
    assert.ok(/DELETE/.test(r.headers['access-control-allow-methods']) && /PATCH/.test(r.headers['access-control-allow-methods']));
  });

  await test('POST /v1/accounts makes an account, bringing the device\'s score code', async function () {
    var p = await call(port, 'POST', '/v1/players');
    await call(port, 'PUT', '/v1/players/' + p.json.code, { easy: 900 });
    var r = await call(port, 'POST', '/v1/accounts', { name: 'Ana', label: 'iPhone', code: p.json.code });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.account.name, 'Ana');
    assert.strictEqual(r.json.account.code, p.json.code);
    ana = r.json;
  });

  await test('GET /v1/me needs a device key', async function () {
    assert.strictEqual((await call(port, 'GET', '/v1/me')).status, 401);
    assert.strictEqual((await call(port, 'GET', '/v1/me', null, 'not-a-real-key-not-a-real-key')).status, 401);
    var me = await call(port, 'GET', '/v1/me', null, ana.key);
    assert.strictEqual(me.status, 200);
    assert.deepStrictEqual(me.json.bests, { easy: 900, normal: 0, hard: 0 });
    assert.strictEqual(me.json.devices[0].label, 'iPhone');
  });

  await test('bests go up through PUT /v1/me/bests, and rename works', async function () {
    var r = await call(port, 'PUT', '/v1/me/bests', { easy: 1200, version: 2, run: 'abcdefgh1234' }, ana.key);
    assert.deepStrictEqual(r.json, { easy: 1200, normal: 0, hard: 0 });
    assert.deepStrictEqual((await call(port, 'PATCH', '/v1/me', { name: 'Ana B' }, ana.key)).json, { name: 'Ana B' });
    assert.strictEqual((await call(port, 'PATCH', '/v1/me', { name: '' }, ana.key)).status, 400);
  });

  await test('a link code adds an iPad, once', async function () {
    link = (await call(port, 'POST', '/v1/me/links', {}, ana.key)).json;
    assert.ok(/^[2-9a-z]{4}-[2-9a-z]{4}$/.test(link.code));
    var r = await call(port, 'POST', '/v1/links/use', { code: link.code, label: 'iPad' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.account.name, 'Ana B');
    ipad = r.json.key;
    assert.strictEqual((await call(port, 'POST', '/v1/links/use', { code: link.code })).status, 404);
    var me = await call(port, 'GET', '/v1/me', null, ipad);
    assert.deepStrictEqual(me.json.bests, { easy: 1200, normal: 0, hard: 0 });
    assert.deepStrictEqual(me.json.devices.map(function (d) { return [d.label, d.current]; }), [['iPhone', false], ['iPad', true]]);
  });

  await test('signing out on the iPad stops its key working', async function () {
    assert.strictEqual((await call(port, 'DELETE', '/v1/me/devices/current', null, ipad)).status, 200);
    assert.strictEqual((await call(port, 'GET', '/v1/me', null, ipad)).status, 401);
    assert.strictEqual((await call(port, 'GET', '/v1/me', null, ana.key)).status, 200);
  });

  await test('the recovery key brings the account to a new phone, and is replaced', async function () {
    var r = await call(port, 'POST', '/v1/recover', { recovery: ana.recovery, label: 'New phone' });
    assert.strictEqual(r.status, 201);
    assert.ok(r.json.recovery && r.json.recovery !== ana.recovery);
    assert.strictEqual((await call(port, 'POST', '/v1/recover', { recovery: ana.recovery })).status, 404);
  });

  await test('guessing link codes is cut off after a few tries a minute', async function () {
    // 3 tries so far in this window (2 link uses, 2 recoveries = 4): the next is refused
    var r = await call(port, 'POST', '/v1/links/use', { code: 'aaaa-aaaa' });
    assert.strictEqual(r.status, 429);
    t += 60000;
    assert.strictEqual((await call(port, 'POST', '/v1/links/use', { code: 'aaaa-aaaa' })).status, 404);
  });

  await test('a saved game up to 64 KB goes up and comes back', async function () {
    assert.strictEqual((await call(port, 'GET', '/v1/me/save', null, ana.key)).status, 404);
    var data = JSON.stringify({ v: 2, pad: 'x'.repeat(30000) });
    var r = await call(port, 'PUT', '/v1/me/save', { data: data, savedAt: t }, ana.key);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json, { kept: true, savedAt: t });
    var back = await call(port, 'GET', '/v1/me/save', null, ana.key);
    assert.strictEqual(back.json.data, data);
    assert.strictEqual((await call(port, 'PUT', '/v1/me/save', { data: 'x'.repeat(70000), savedAt: t }, ana.key)).status, 413);
    assert.strictEqual((await call(port, 'GET', '/v1/me/save')).status, 401);
  });

  await test('an unknown /v1/me route is 404, not a crash', async function () {
    assert.strictEqual((await call(port, 'GET', '/v1/me/nothing', null, ana.key)).status, 404);
    assert.strictEqual((await call(port, 'DELETE', '/v1/me/devices/nope', null, ana.key)).status, 404);
  });

  server.close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.log('FAIL  harness\n      ' + e.stack); process.exit(1); });
