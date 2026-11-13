/* storage.js: browser storage that never breaks the game, and the name of every key it uses.
   Loaded before app.js. window.TenSpotStorage = { store, KEYS }.
   The keys still start with "numbermatch": renaming them would lose everyone's saves and bests. */
(function () {
  'use strict';
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };
  var KEYS = {
    best: 'numbermatch.best3.', // + easy|normal|hard (where the run started). Fresh with the ramp.
    theme: 'numbermatch.theme', // 'light'|'dark'
    sound: 'numbermatch.sound', // 'on'|'off'; missing means off
    player: 'numbermatch.player',
    account: 'numbermatch.account',   // the signed-in account: { key, name } (see account.js)
    save: 'numbermatch.save1', // the game in progress (see save.js)
    diff: 'numbermatch.diff', // where the last run started: easy|normal|hard
    reached: 'numbermatch.reached', // highest level reached on this device (unlocks Start at Normal / Hard)
    guide: 'numbermatch.guide', // 'done' once the first-level pointers have been seen or skipped
    ends: 'numbermatch.ends' // run ends waiting to be sent to the score server (see scores-client.js)
  };
  window.TenSpotStorage = { store: store, KEYS: KEYS };
})();
