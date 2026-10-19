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
      return call(port, 'POST', '/v1/boards', {
        diff: 'easy', level: 2, mode: 'num', seed: 9, cells: [{ v: 1, solid: true }, { v: 9, solid: true }]
      }, 'https://ten-spot.example');
    })
    .then(function (res) {
      test('POST stores a board and returns a short code', function () {
        assert.strictEqual(res.status, 201);
        assert.match(res.json.code, /^[0-9a-z]{3}-[0-9a-z]{3}$/);
        assert.strictEqual(res.json.seed, 9);
      });
      var code = res.json.code;
      return call(port, 'POST', '/v1/boards', {
        diff: 'easy', level: 2, mode: 'num', seed: 9, cells: [{ v: 1, solid: true }, { v: 9, solid: true }]
      }, 'https://ten-spot.example').then(function (again) {
        return call(port, 'GET', '/v1/boards/' + code.toUpperCase(), null, 'https://ten-spot.example').then(function (got) {
          return { again: again, got: got, code: code };
        });
      });
    })
    .then(function (ctx) {
      test('the same board returns the same code, in any case', function () {
        assert.strictEqual(ctx.again.status, 201);
        assert.strictEqual(ctx.again.json.code, ctx.code);
        assert.strictEqual(ctx.got.status, 200);
        assert.strictEqual(ctx.got.json.code, ctx.code);
        assert.strictEqual(ctx.got.json.mode, 'num');
      });
      return call(port, 'GET', '/v1/boards/nope', null, 'https://ten-spot.example');
    })
    .then(function (res) {
      test('an unknown board code is 404', function () {
        assert.strictEqual(res.status, 404);
      });
      return call(port, 'PUT', '/v1/players/2345-6789-abcd-efgh', 'x'.repeat(8193), 'https://ten-spot.example');
    })
    .then(function (res) {
      test('a body over 8192 bytes is 413', function () {
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
