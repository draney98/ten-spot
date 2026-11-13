(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NumberMatchScores = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var RUN_ID = /^[0-9a-z]{8,32}$/;   // a run id from game-logic.js newRunId
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

  /** One call to the score server. Resolves (never rejects) with { ok, status, body, error };
      status 0 means the server couldn't be reached. `key`, optional: a device key, sent as
      "Authorization: Bearer <key>" for the account routes. */
  function send(base, method, path, body, fetchFn, key) {
    var opts = { method: method, headers: { 'content-type': 'application/json' } };
    if (key) opts.headers.authorization = 'Bearer ' + key;
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

  /** Raise bests on a score code. `about`, optional: { version, run }, the rules version and run id
      the bests were made under; the server logs them with any best that goes up. */
  function putBests(base, code, bests, fetchFn, about) {
    var id = normalizeCode(code);
    if (!id) return invalid();
    var body = {};
    for (var k in bests) if (Object.prototype.hasOwnProperty.call(bests, k)) body[k] = bests[k];
    if (about && Number.isInteger(about.version)) body.version = about.version;
    if (about && typeof about.run === 'string' && RUN_ID.test(about.run)) body.run = about.run;
    return send(base, 'PUT', '/v1/players/' + id, body, fetchFn);
  }

  function createPlayer(base, fetchFn) {
    return send(base, 'POST', '/v1/players', {}, fetchFn);
  }

  function parseBoardCode(input) {
    if (typeof input !== 'string') return null;
    var raw = input.toLowerCase().replace(/[\s-]/g, '');
    if (!/^[0-9a-z]{6}$/.test(raw)) return null;
    return raw.slice(0, 3) + '-' + raw.slice(3);
  }

  function saveBoard(base, board, fetchFn) {
    return send(base, 'POST', '/v1/boards', board, fetchFn);
  }

  function getBoard(base, code, fetchFn) {
    var id = parseBoardCode(code);
    if (!id) return invalid();
    return send(base, 'GET', '/v1/boards/' + id, null, fetchFn);
  }

  /* ---- run ends: the level a run ended on, sent to the server with nothing about the player ---- */
  var STARTS = ['easy', 'normal', 'hard'];
  var MAX_WAITING = 50;

  /** A run end to keep: start point, level and rules version, plus the run id when there is a good one. */
  function cleanRun(r) {
    var o = { start: r.start, level: r.level, version: r.version };
    if (typeof r.run === 'string' && RUN_ID.test(r.run)) o.run = r.run;
    return o;
  }
  function goodRun(r) {
    return !!r && STARTS.indexOf(r.start) !== -1 &&
      Number.isInteger(r.level) && r.level >= 1 && r.level <= 999 &&
      Number.isInteger(r.version) && r.version >= 1 && r.version <= 9999;
  }

  /** The waiting list is kept as text in browser storage. Bad text reads as an empty list. */
  function readRunEnds(text) {
    var list;
    try { list = JSON.parse(text || '[]'); } catch (e) { return []; }
    if (!Array.isArray(list)) return [];
    return list.filter(goodRun).map(cleanRun);
  }

  /** Add one run end to the waiting list. Returns the new list as text. Keeps the newest 50. */
  function addRunEnd(text, run) {
    var list = readRunEnds(text);
    if (goodRun(run)) list.push(cleanRun(run));
    if (list.length > MAX_WAITING) list = list.slice(list.length - MAX_WAITING);
    return JSON.stringify(list);
  }

  /** Send the waiting run ends, oldest first. Stops at the first one the server can't be reached for.
      One the server refuses (400) is dropped. Resolves with what is still waiting, as text. */
  function flushRunEnds(base, text, fetchFn) {
    var list = readRunEnds(text);
    function next() {
      if (!list.length) return Promise.resolve('[]');
      return send(base, 'POST', '/v1/runs', list[0], fetchFn).then(function (res) {
        if (res.ok || res.status === 400) { list.shift(); return next(); }
        return JSON.stringify(list);
      });
    }
    return next();
  }

  function getRunEnds(base, version, fetchFn) {
    return send(base, 'GET', '/v1/runs' + (version == null ? '' : '?version=' + version), null, fetchFn);
  }

  /* ---- accounts (see server/accounts.js) ----
     A signed-in device keeps { key, name } in storage. The key goes only to the score server. */
  /** A link code as typed or pasted (with or without the dash, any case), or a link holding one. */
  function normalizeLink(input) {
    if (typeof input !== 'string') return null;
    var m = input.match(/[?&]link=([^&#\s]+)/);
    var raw = (m ? decodeURIComponent(m[1]) : input).toLowerCase().replace(/[\s-]/g, '');
    if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(raw)) return null;
    return raw.slice(0, 4) + '-' + raw.slice(4);
  }
  /** A recovery key, or a recovery link holding one. */
  function normalizeRecovery(input) {
    if (typeof input !== 'string') return null;
    var m = input.match(/[?&]recover=([^&#\s]+)/);
    var raw = (m ? decodeURIComponent(m[1]) : input).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
  }
  /** The stored account, or null. Bad text reads as signed out. */
  function readAccount(text) {
    var a;
    try { a = JSON.parse(text || 'null'); } catch (e) { return null; }
    if (!a || typeof a.key !== 'string' || a.key.length < 20 || typeof a.name !== 'string') return null;
    return { key: a.key, name: a.name };
  }
  function writeAccount(a) { return JSON.stringify({ key: a.key, name: a.name }); }

  function createAccount(base, body, fetchFn) { return send(base, 'POST', '/v1/accounts', body, fetchFn); }
  function useLink(base, body, fetchFn) { return send(base, 'POST', '/v1/links/use', body, fetchFn); }
  function recover(base, body, fetchFn) { return send(base, 'POST', '/v1/recover', body, fetchFn); }
  function getMe(base, key, fetchFn) { return send(base, 'GET', '/v1/me', null, fetchFn, key); }
  function renameMe(base, key, name, fetchFn) { return send(base, 'PATCH', '/v1/me', { name: name }, fetchFn, key); }
  function putMeBests(base, key, bests, fetchFn, about) {
    var body = {};
    for (var k in bests) if (Object.prototype.hasOwnProperty.call(bests, k)) body[k] = bests[k];
    if (about && Number.isInteger(about.version)) body.version = about.version;
    if (about && typeof about.run === 'string' && RUN_ID.test(about.run)) body.run = about.run;
    return send(base, 'PUT', '/v1/me/bests', body, fetchFn, key);
  }
  function foldCode(base, key, code, fetchFn) { return send(base, 'POST', '/v1/me/fold', { code: code }, fetchFn, key); }
  function makeLink(base, key, fetchFn) { return send(base, 'POST', '/v1/me/links', {}, fetchFn, key); }
  function newRecovery(base, key, fetchFn) { return send(base, 'POST', '/v1/me/recovery', {}, fetchFn, key); }
  function removeDevice(base, key, id, fetchFn) { return send(base, 'DELETE', '/v1/me/devices/' + encodeURIComponent(id), null, fetchFn, key); }

  /** A short name for this device in the account's device list, from the browser's user agent. */
  function deviceLabel(ua) {
    ua = String(ua || '');
    var what = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
      : /CrOS/.test(ua) ? 'Chromebook' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Browser';
    var app = /Edg\//.test(ua) ? 'Edge' : /(CriOS|Chrome)\//.test(ua) ? 'Chrome' : /(FxiOS|Firefox)\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return app ? what + ' · ' + app : what;
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
    parseBoardCode: parseBoardCode,
    saveBoard: saveBoard,
    getBoard: getBoard,
    shouldSync: shouldSync,
    normalizeLink: normalizeLink,
    normalizeRecovery: normalizeRecovery,
    readAccount: readAccount,
    writeAccount: writeAccount,
    createAccount: createAccount,
    useLink: useLink,
    recover: recover,
    getMe: getMe,
    renameMe: renameMe,
    putMeBests: putMeBests,
    foldCode: foldCode,
    makeLink: makeLink,
    newRecovery: newRecovery,
    removeDevice: removeDevice,
    deviceLabel: deviceLabel,
    readRunEnds: readRunEnds,
    addRunEnd: addRunEnd,
    flushRunEnds: flushRunEnds,
    getRunEnds: getRunEnds
  };
});
