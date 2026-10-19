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

test('shouldSync is false without an origin or a code', function () {
  assert.strictEqual(client.shouldSync('', '2345-6789-abcd-efgh'), false);
  assert.strictEqual(client.shouldSync('https://scores.example', ''), false);
  assert.strictEqual(client.shouldSync('https://scores.example', '2345-6789-abcd-efgh'), true);
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

test('parseBoardCode accepts six letters or digits around a dash', function () {
  assert.strictEqual(client.parseBoardCode('XY7-fg9'), 'xy7-fg9');
  assert.strictEqual(client.parseBoardCode('xy7fg9'), 'xy7-fg9');
  assert.strictEqual(client.parseBoardCode('xy7-fg'), null);
  assert.strictEqual(client.parseBoardCode('normal-1-icons-00a1b2c3'), null);
});

test('saveBoard posts the opening board and getBoard reads a short code', function () {
  var board = { diff: 'normal', level: 1, mode: 'icons', seed: 5, cells: [{ v: 1 }] };
  return client.saveBoard('https://scores.example', board, function (url, opts) {
    assert.strictEqual(url, 'https://scores.example/v1/boards');
    assert.strictEqual(opts.method, 'POST');
    assert.strictEqual(JSON.parse(opts.body).seed, 5);
    return Promise.resolve({
      ok: true, status: 201,
      json: function () { return Promise.resolve({ code: 'xy7-fg9', diff: 'normal', level: 1, mode: 'icons', seed: 5 }); }
    });
  }).then(function (res) {
    assert.strictEqual(res.body.code, 'xy7-fg9');
    return client.getBoard('https://scores.example', 'XY7-FG9', function (url) {
      assert.strictEqual(url, 'https://scores.example/v1/boards/xy7-fg9');
      return Promise.resolve({
        ok: true, status: 200,
        json: function () { return Promise.resolve({ code: 'xy7-fg9', seed: 5 }); }
      });
    });
  }).then(function (res) {
    assert.strictEqual(res.body.seed, 5);
  });
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
