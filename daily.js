/* daily.js: the Daily's rules, with no page code. Works in the browser (window.TenSpotDaily) and in node (tests).
   A day is the date in US Eastern time, so it turns over at the same moment for everyone.
   Three boards that zoom out (3 x 3, 5 x 5, 7 x 7, empty centre), from the score server when the
   designer filled the day, otherwise dealt from the date (the same for everyone).
   Scored in Adds against par. Your first try counts; replays are practice.
   A streak counts days played in a row; one missed day a week (Monday to Sunday) is forgiven.

   The book (kept on the device as JSON): { results: { 'YYYY-MM-DD': result } }
   result: { boards: [{ adds, par, perfect, lost }], at: time it was finished } */
(function (root, factory) {
  var api = factory(typeof require === 'function' && typeof module === 'object' ? require('./game-logic.js') : root.NumberMatchLogic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TenSpotDaily = api;
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var ZONE = 'America/New_York';
  var FIRST_DAY = '2026-11-01';   // Daily 1 (numbers in the share line count from here)
  /** Par for a board dealt from the date (a day nobody filled): what the casual bot needs on
      dealt boards of each shape (measured in the designer: 0, 0 or 1, about 1). */
  var DEALT_PAR = [0, 1, 1];

  /** The date in US Eastern time for a moment (a Date or ms), as YYYY-MM-DD. */
  function dayOf(when) {
    var d = when instanceof Date ? when : new Date(when == null ? Date.now() : when);
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    var get = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  function utc(day) { return Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)); }
  /** Whole days from a to b (both YYYY-MM-DD). */
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  /** The day n days after (or before) a day. */
  function addDays(day, n) { return new Date(utc(day) + n * 86400000).toISOString().slice(0, 10); }
  /** Daily number for the share line: 1 on FIRST_DAY. */
  function dayNumber(day) { return daysBetween(FIRST_DAY, day) + 1; }
  /** Monday of the day's week (weeks run Monday to Sunday). */
  function weekOf(day) { var wd = (new Date(utc(day)).getUTCDay() + 6) % 7; return addDays(day, -wd); }

  /** A number from the date, the same everywhere, for dealing a day nobody filled. */
  function daySeed(day, n) {
    var h = 2166136261;
    var text = 'ten-spot daily ' + day + ' ' + n;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /** The day's three boards: the server's where set (and of the right shape), otherwise dealt from the date. */
  function boardsFor(day, fromServer) {
    return [0, 1, 2].map(function (i) {
      var given = fromServer && fromServer[i];
      if (given && L.checkDesign(given).ok && L.fitsDailyShape(given, i + 1)) return given;
      var sh = L.DAILY_SHAPES[i];
      var d = L.dealDesign({ cols: sh.cols, rows: sh.rows, mascots: sh.mascots, centre: true, adds: sh.adds, level: sh.level, seed: daySeed(day, i + 1) });
      d.dealt = true;   // not hand-picked
      d.par = DEALT_PAR[i];
      return d;
    });
  }

  /** One board's result from its finished state. */
  function boardResult(design, s) {
    var start = design.adds != null ? design.adds : L.addsFor(design.level);
    var r = L.runStats(s);
    return {
      adds: Math.max(0, start - (s.addsLeft || 0)),
      par: design.par != null ? design.par : start,
      perfect: s.status === 'clear' && !r.mistakes && !r.hints && !r.undos,
      lost: s.status !== 'clear'
    };
  }

  function emptyBook() { return { results: {} }; }
  function readBook(text) {
    try {
      var b = JSON.parse(text);
      if (b && typeof b === 'object' && b.results && typeof b.results === 'object') return b;
    } catch (e) { /* not a book */ }
    return emptyBook();
  }
  /** Record a day's result. Only the first try counts: an existing result is kept. Returns true if recorded. */
  function record(book, day, boards, at) {
    if (book.results[day]) return false;
    book.results[day] = { boards: boards, at: at || Date.now() };
    return true;
  }

  /** Days played in a row up to today (or yesterday, if today is not played yet). A missed day is
      forgiven once per Monday-to-Sunday week. { days, playedToday } */
  function streak(book, today) {
    var played = function (d) { return !!book.results[d]; };
    var playedToday = played(today);
    var day = playedToday ? today : addDays(today, -1);
    var days = 0, skipsUsed = {}, guard = 0;
    while (guard++ < 4000) {
      if (played(day)) { days++; day = addDays(day, -1); continue; }
      var wk = weekOf(day);
      // a missed day is forgiven if its week has no other forgiven day and the day before it was played
      if (!skipsUsed[wk] && played(addDays(day, -1))) { skipsUsed[wk] = true; day = addDays(day, -1); continue; }
      break;
    }
    return { days: days, playedToday: playedToday };
  }

  /** The last `n` days ending today: [{ day, state: 'played' | 'missed' | 'today' }] */
  function calendar(book, today, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var d = addDays(today, -i);
      out.push({ day: d, state: book.results[d] ? 'played' : d === today ? 'today' : 'missed' });
    }
    return out;
  }

  /** One board's row: ⬜ an Add used within par, 🟩 an Add you didn't need (or 🟩 alone when par was 0
      and you used none), 🟥 an Add over par, ⭐ a perfect board, ✖ a board that beat you. */
  function row(b) {
    if (b.lost) return '✖';
    var within = Math.min(b.adds, b.par), saved = Math.max(0, b.par - b.adds), over = Math.max(0, b.adds - b.par);
    var squares = rep('⬜', within) + rep('🟩', saved) + rep('🟥', over);
    return (squares || '🟩') + (b.perfect ? ' ⭐' : '');
  }
  function rep(s, n) { var out = ''; for (var i = 0; i < n; i++) out += s; return out; }
  /** Adds against par over the boards cleared: negative is under par. */
  function total(boards) {
    return boards.reduce(function (t, b) { return b.lost ? t : t + b.adds - b.par; }, 0);
  }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : 'E'; }
  /** The share text: a header, then one row per board. */
  function shareText(day, boards, streakDays) {
    var head = 'ten-spot Daily ' + dayNumber(day) + ' ⛳ ' + signed(total(boards)) + (streakDays > 1 ? ' 🔥' + streakDays : '');
    return [head].concat(boards.map(row)).join('\n');
  }

  return {
    ZONE: ZONE, FIRST_DAY: FIRST_DAY, DEALT_PAR: DEALT_PAR, dayOf: dayOf, daysBetween: daysBetween, addDays: addDays, dayNumber: dayNumber, weekOf: weekOf,
    daySeed: daySeed, boardsFor: boardsFor, boardResult: boardResult,
    emptyBook: emptyBook, readBook: readBook, record: record, streak: streak, calendar: calendar,
    row: row, total: total, signed: signed, shareText: shareText
  };
});
