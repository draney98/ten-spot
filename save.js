/* save.js: turn a game into text for browser storage, and back again.
   Pure functions, no DOM, so they can be tested in node.
   pack(state, extras)  -> string
   unpack(text)         -> { state, extras, savedAt } or null (null = start a fresh game) */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NumberMatchSave = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var KEEP_HISTORY = 50;   // undo steps kept in a save
  var DIFFS = ['easy', 'normal', 'hard'];
  var STATUSES = ['playing', 'clear', 'lose'];
  var UNLIMITED = ['hintsLeft', 'undosLeft', 'compactsLeft'];

  function pack(state, extras) {
    var s = {};
    for (var k in state) if (Object.prototype.hasOwnProperty.call(state, k)) s[k] = state[k];
    // JSON turns Infinity into null, so write Easy's unlimited counts as "inf".
    UNLIMITED.forEach(function (k) { if (s[k] === Infinity) s[k] = 'inf'; });
    if (Array.isArray(s.history) && s.history.length > KEEP_HISTORY) {
      s.history = s.history.slice(s.history.length - KEEP_HISTORY);
    }
    return JSON.stringify({ v: VERSION, savedAt: Date.now(), state: s, extras: extras || {} });
  }

  function unpack(text) {
    if (typeof text !== 'string' || !text) return null;
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    if (!data || data.v !== VERSION || !data.state || typeof data.state !== 'object') return null;
    var s = data.state;
    if (DIFFS.indexOf(s.diff) === -1) return null;
    if (STATUSES.indexOf(s.status) === -1) return null;
    if (!Array.isArray(s.cells) || !s.cells.length) return null;
    if (!(s.level >= 1) || !(s.cols >= 1) || typeof s.score !== 'number') return null;
    for (var i = 0; i < s.cells.length; i++) {
      var c = s.cells[i];
      if (!c || typeof c.id !== 'number' || typeof c.v !== 'number') return null;
    }
    UNLIMITED.forEach(function (k) { if (s[k] === 'inf') s[k] = Infinity; });
    if (!Array.isArray(s.history)) s.history = [];
    return { state: s, extras: data.extras || {}, savedAt: data.savedAt || 0 };
  }

  return { pack: pack, unpack: unpack, VERSION: VERSION, KEEP_HISTORY: KEEP_HISTORY };
});
