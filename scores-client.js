(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NumberMatchScores = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
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

  function send(base, method, path, body, fetchFn) {
    var opts = { method: method, headers: { 'content-type': 'application/json' } };
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

  function putBests(base, code, bests, fetchFn) {
    var id = normalizeCode(code);
    if (!id) return invalid();
    return send(base, 'PUT', '/v1/players/' + id, bests, fetchFn);
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
    shouldSync: shouldSync
  };
});
