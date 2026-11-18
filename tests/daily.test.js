/* Run with:  node tests/daily.test.js
   The Daily's rules (daily.js): the day, the boards, results, the streak and the share grid. */
'use strict';
var assert = require('assert');
var L = require('../game-logic.js');
var D = require('../daily.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

test('the day is the date in US Eastern time, for everyone', function () {
  assert.strictEqual(D.dayOf(Date.UTC(2026, 10, 18, 4, 59)), '2026-11-17', '11:59 pm in New York');
  assert.strictEqual(D.dayOf(Date.UTC(2026, 10, 18, 5, 0)), '2026-11-18', 'midnight in New York');
  assert.strictEqual(D.dayOf(Date.UTC(2026, 6, 4, 3, 59)), '2026-07-03', 'summer time: UTC-4');
  assert.strictEqual(D.dayNumber('2026-11-01'), 1);
  assert.strictEqual(D.dayNumber('2026-11-18'), 18);
  assert.strictEqual(D.addDays('2026-11-30', 1), '2026-12-01');
  assert.strictEqual(D.weekOf('2026-11-18'), '2026-11-16', 'Wednesday -> Monday');
  assert.strictEqual(D.weekOf('2026-11-22'), '2026-11-16', 'Sunday ends the week');
});

test('the boards: the server\'s where set, otherwise dealt from the date, the same for everyone', function () {
  var day = '2026-11-18';
  var dealt = D.boardsFor(day, null);
  assert.strictEqual(dealt.length, 3);
  dealt.forEach(function (d, i) {
    assert.ok(L.fitsDailyShape(d, i + 1), 'board ' + (i + 1) + ' shape');
    assert.strictEqual(L.designBeatable(d), true);
    assert.strictEqual(d.par, D.DEALT_PAR[i]);
    assert.strictEqual(d.dealt, true);
  });
  assert.deepStrictEqual(D.boardsFor(day, null), dealt, 'same date, same boards');
  assert.notDeepStrictEqual(D.boardsFor('2026-11-19', null)[1].cells, dealt[1].cells, 'another date, other boards');
  var picked = Object.assign(L.dealDesign({ cols: 5, rows: 5, mascots: 4, centre: true, adds: 2, level: 25, seed: 99 }), { name: 'Picked', par: 1 });
  var mixed = D.boardsFor(day, [null, picked, { v: 1, level: 1, cols: 5, cells: [1, 1] }]);
  assert.strictEqual(mixed[1].name, 'Picked');
  assert.ok(mixed[2].dealt, 'a board of the wrong shape is replaced by a dealt one');
});

test('a board\'s result: Adds used, par, perfect, lost', function () {
  var d = { v: 1, level: 10, cols: 3, cells: [1, 1, 3, 3, 0, 5, 5, 7, 7], adds: 1, par: 0 };
  var s = L.stateFromDesign(d);
  [[1, 2], [3, 4], [6, 7], [8, 9]].forEach(function (p) { s = L.select(L.select(s, p[0]).state, p[1]).state; });
  assert.deepStrictEqual(D.boardResult(d, s), { adds: 0, par: 0, perfect: true, lost: false });
  var used = L.stateFromDesign(d); used.addsLeft = 0; used.status = 'lose';
  assert.deepStrictEqual(D.boardResult(d, used), { adds: 1, par: 0, perfect: false, lost: true });
});

test('the share grid: one row per board, squares for Adds, a header with par and streak', function () {
  assert.strictEqual(D.row({ adds: 0, par: 2, perfect: true, lost: false }), '🟩🟩 ⭐');
  assert.strictEqual(D.row({ adds: 3, par: 3, perfect: false, lost: false }), '⬜⬜⬜');
  assert.strictEqual(D.row({ adds: 4, par: 3, perfect: false, lost: false }), '⬜⬜⬜🟥');
  assert.strictEqual(D.row({ adds: 0, par: 0, perfect: false, lost: false }), '🟩', 'nothing used, nothing to spare');
  assert.strictEqual(D.row({ adds: 2, par: 1, perfect: false, lost: true }), '✖');
  var boards = [{ adds: 0, par: 2, perfect: true, lost: false }, { adds: 3, par: 3, perfect: false, lost: false }, { adds: 4, par: 3, perfect: false, lost: false }];
  assert.strictEqual(D.total(boards), -1);
  assert.strictEqual(D.shareText('2026-11-18', boards, 5), 'ten-spot Daily 18 ⛳ −1 🔥5\n🟩🟩 ⭐\n⬜⬜⬜\n⬜⬜⬜🟥');
  assert.strictEqual(D.shareText('2026-11-18', boards, 1).split('\n')[0], 'ten-spot Daily 18 ⛳ −1', 'no fire for a one-day streak');
  assert.strictEqual(D.signed(0), 'E');
  assert.strictEqual(D.signed(2), '+2');
});

test('only the first try counts', function () {
  var book = D.emptyBook();
  assert.strictEqual(D.record(book, '2026-11-18', [{ adds: 1, par: 1 }], 1), true);
  assert.strictEqual(D.record(book, '2026-11-18', [{ adds: 0, par: 1 }], 2), false);
  assert.strictEqual(book.results['2026-11-18'].boards[0].adds, 1);
  assert.deepStrictEqual(D.readBook(JSON.stringify(book)), book);
  assert.deepStrictEqual(D.readBook('not json'), D.emptyBook());
});

test('the streak: days in a row, with one missed day a week forgiven', function () {
  function book(days) { var b = D.emptyBook(); days.forEach(function (d) { D.record(b, d, [], 1); }); return b; }
  assert.deepStrictEqual(D.streak(book([]), '2026-11-18'), { days: 0, playedToday: false });
  assert.deepStrictEqual(D.streak(book(['2026-11-16', '2026-11-17', '2026-11-18']), '2026-11-18'), { days: 3, playedToday: true });
  assert.strictEqual(D.streak(book(['2026-11-16', '2026-11-17']), '2026-11-18').days, 2, 'today not played yet: still 2');
  assert.strictEqual(D.streak(book(['2026-11-16', '2026-11-18']), '2026-11-18').days, 2, 'Tuesday missed, forgiven');
  assert.strictEqual(D.streak(book(['2026-11-16']), '2026-11-18').days, 1, 'missed yesterday, today not played yet: forgiven for now');
  assert.strictEqual(D.streak(book(['2026-11-16']), '2026-11-19').days, 0, 'two days missed in one week: over');
  assert.strictEqual(D.streak(book(['2026-11-14', '2026-11-16', '2026-11-18']), '2026-11-18').days, 3, 'one miss in each of two weeks');
  assert.strictEqual(D.streak(book(['2026-11-12', '2026-11-14', '2026-11-16']), '2026-11-16').days, 2, 'two misses in one week (Nov 13 is forgiven, Nov 15 is not)');
});

test('the calendar: the last n days, played or missed', function () {
  var b = D.emptyBook(); D.record(b, '2026-11-16', [], 1); D.record(b, '2026-11-18', [], 1);
  assert.deepStrictEqual(D.calendar(b, '2026-11-18', 3).map(function (c) { return c.state; }), ['played', 'missed', 'played']);
  assert.deepStrictEqual(D.calendar(D.emptyBook(), '2026-11-18', 2).map(function (c) { return c.state; }), ['missed', 'today']);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
