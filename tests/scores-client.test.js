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

test('addRunEnd adds to the waiting list, drops bad ones and keeps the newest 50', function () {
  var text = client.addRunEnd(null, { start: 'easy', level: 12, version: 1 });
  assert.deepStrictEqual(JSON.parse(text), [{ start: 'easy', level: 12, version: 1 }]);
  assert.strictEqual(client.addRunEnd(text, { start: 'nope', level: 12, version: 1 }), text);
  assert.deepStrictEqual(client.readRunEnds('not json'), []);
  for (var i = 1; i <= 60; i++) text = client.addRunEnd(text, { start: 'hard', level: i, version: 1 });
  var list = client.readRunEnds(text);
  assert.strictEqual(list.length, 50);
  assert.strictEqual(list[49].level, 60);
});

test('flushRunEnds sends oldest first and keeps what could not be sent', function () {
  var text = JSON.stringify([{ start: 'easy', level: 5, version: 1 }, { start: 'easy', level: 9, version: 1 }]);
  var sent = [];
  return client.flushRunEnds('https://scores.example', text, function (url, opts) {
    assert.strictEqual(url, 'https://scores.example/v1/runs');
    sent.push(JSON.parse(opts.body).level);
    if (sent.length === 2) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: true, status: 201, json: function () { return Promise.resolve({ ok: true }); } });
  }).then(function (left) {
    assert.deepStrictEqual(sent, [5, 9]);
    assert.deepStrictEqual(JSON.parse(left), [{ start: 'easy', level: 9, version: 1 }]);
  });
});

test('a run id is kept with a waiting run end, and a bad one is dropped', function () {
  var text = client.addRunEnd(null, { start: 'easy', level: 12, version: 2, run: 'abc123def456' });
  text = client.addRunEnd(text, { start: 'easy', level: 13, version: 2, run: 'NOT OK' });
  assert.deepStrictEqual(client.readRunEnds(text), [
    { start: 'easy', level: 12, version: 2, run: 'abc123def456' },
    { start: 'easy', level: 13, version: 2 }
  ]);
});

test('putBests sends the rules version and run id with the bests', function () {
  var body = null;
  return client.putBests('https://scores.example', '2345-6789-abcd-efgh', { easy: 10, normal: 0, hard: 0 }, function (url, opts) {
    body = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  }, { version: 2, run: 'abc123def456' }).then(function () {
    assert.deepStrictEqual(body, { easy: 10, normal: 0, hard: 0, version: 2, run: 'abc123def456' });
    return client.putBests('https://scores.example', '2345-6789-abcd-efgh', { easy: 10 }, function (url, opts) {
      body = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
    });
  }).then(function () {
    assert.deepStrictEqual(body, { easy: 10 }, 'nothing extra when there is nothing to say');
  });
});

test('link codes and recovery links are read from what people type or paste', function () {
  assert.strictEqual(client.normalizeLink('AB3K-9MXQ'), 'ab3k-9mxq');
  assert.strictEqual(client.normalizeLink(' ab3k 9mxq '), 'ab3k-9mxq');
  assert.strictEqual(client.normalizeLink('https://ten-spot.onrender.com/?link=ab3k-9mxq'), 'ab3k-9mxq');
  assert.strictEqual(client.normalizeLink('ab1k9mxq'), null, '1 is not in the alphabet');
  var key = 'A'.repeat(20) + '_-' + 'z'.repeat(21);
  assert.strictEqual(client.normalizeRecovery(key), key);
  assert.strictEqual(client.normalizeRecovery('https://ten-spot.onrender.com/?recover=' + key), key);
  assert.strictEqual(client.normalizeRecovery('short'), null);
});

test('the stored account is read safely', function () {
  var text = client.writeAccount({ key: 'k'.repeat(43), name: 'Ana', extra: 1 });
  assert.deepStrictEqual(client.readAccount(text), { key: 'k'.repeat(43), name: 'Ana' });
  assert.strictEqual(client.readAccount('not json'), null);
  assert.strictEqual(client.readAccount(null), null);
  assert.strictEqual(client.readAccount(JSON.stringify({ key: 'short', name: 'x' })), null);
});

test('account calls send the device key as a Bearer header', function () {
  var seen = [];
  function fake(url, opts) {
    seen.push([opts.method, url.replace('https://s.example', ''), opts.headers.authorization || '', opts.body ? JSON.parse(opts.body) : null]);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  }
  var k = 'k'.repeat(43);
  return Promise.all([
    client.createAccount('https://s.example', { name: 'Ana' }, fake),
    client.getMe('https://s.example', k, fake),
    client.putMeBests('https://s.example', k, { easy: 5 }, fake, { version: 2, run: 'abcdefgh1234' }),
    client.removeDevice('https://s.example', k, 'current', fake)
  ]).then(function () {
    assert.deepStrictEqual(seen, [
      ['POST', '/v1/accounts', '', { name: 'Ana' }],
      ['GET', '/v1/me', 'Bearer ' + k, null],
      ['PUT', '/v1/me/bests', 'Bearer ' + k, { easy: 5, version: 2, run: 'abcdefgh1234' }],
      ['DELETE', '/v1/me/devices/current', 'Bearer ' + k, null]
    ]);
  });
});

test('device labels', function () {
  assert.strictEqual(client.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
  assert.strictEqual(client.deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'), 'Android phone · Chrome');
  assert.strictEqual(client.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'), 'Mac · Safari');
  assert.strictEqual(client.deviceLabel(''), 'Browser');
});

setTimeout(function () {
  Promise.all(pending).then(function () {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
}, 0);
