'use strict';
var http = require('http');
var scores = require('./scores.js');
var limits = require('./limits.js');
var accounts = require('./accounts.js');

var MAX_BODY = 8192;

function send(req, res, status, body, origin, extra) {
  var headers = { 'content-type': 'application/json; charset=utf-8' };
  for (var k in (extra || {})) headers[k] = extra[k];
  if (origin && req.headers.origin === origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type, authorization';
    headers['vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body == null ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var size = 0;
    var chunks = [];
    var failed = false;
    req.on('data', function (chunk) {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        failed = true;
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', function (err) { if (!failed) reject(err); });
  });
}

/** The device key from "Authorization: Bearer <key>", or null. */
function bearer(req) {
  var h = req.headers.authorization;
  var m = typeof h === 'string' && h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/** opts: { db, origin, limits (rules for limits.js; tests pass small ones), now (a clock, tests) } */
function createScoresServer(opts) {
  var db = opts.db;
  var origin = opts.origin || '';
  var clock = opts.now || Date.now;
  var limiter = limits.createLimiter(opts.limits, opts.now);
  /** True when this post may go ahead; otherwise sends 429 and returns false. */
  function allowed(name, req, res) {
    var r = limiter.check(name, limits.clientAddress(req));
    if (r.ok) return true;
    req.resume();   // drop the body
    send(req, res, 429, { error: 'too many requests' }, origin, { 'retry-after': String(r.retryAfter) });
    return false;
  }
  /** Read a JSON body and answer with handle(body): its return value with `status`, or its error.
      An error with e.status uses it; any other error is a 400 with its message. */
  function json(req, res, status, handle) {
    readBody(req).then(function (text) {
      var body;
      try { body = JSON.parse(text || '{}'); }
      catch (e) { return send(req, res, 400, { error: 'invalid json' }, origin); }
      var out;
      try { out = handle(body); }
      catch (e) { return send(req, res, e.status || 400, { error: e.message }, origin); }
      if (out == null) return send(req, res, 404, { error: 'unknown code' }, origin);
      return send(req, res, status, out, origin);
    }).catch(function (e) {
      if (!res.headersSent) send(req, res, e.status || 400, { error: e.message }, origin);
    });
  }
  /** The signed-in device, or null after answering 401. */
  function who(req, res) {
    var w = accounts.signedIn(db, bearer(req));
    if (w) return w;
    req.resume();
    send(req, res, 401, { error: 'not signed in' }, origin);
    return null;
  }

  return http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://127.0.0.1');
    var path = url.pathname, method = req.method, w, m;
    if (method === 'OPTIONS') return send(req, res, 204, null, origin);
    if (method === 'GET' && path === '/health') return send(req, res, 200, { ok: true }, origin);

    /* ---- score codes, boards and run ends ---- */
    if (method === 'POST' && path === '/v1/players') {
      if (!allowed('players', req, res)) return;
      return send(req, res, 201, scores.createPlayer(db), origin);
    }
    if (method === 'POST' && path === '/v1/boards') {
      if (!allowed('boards', req, res)) return;
      return json(req, res, 201, function (body) { return scores.saveBoard(db, body); });
    }
    if (method === 'POST' && path === '/v1/runs') {
      if (!allowed('runs', req, res)) return;
      return json(req, res, 201, function (body) { scores.countRunEnd(db, body); return { ok: true }; });
    }
    if (method === 'GET' && path === '/v1/runs') {
      var wanted = url.searchParams.get('version');
      var ver = wanted == null ? null : Number(wanted);
      if (ver !== null && !(Number.isInteger(ver) && ver >= 1 && ver <= 9999)) return send(req, res, 400, { error: 'invalid version' }, origin);
      return send(req, res, 200, { runs: scores.runEnds(db, ver) }, origin);
    }
    if ((m = path.match(/^\/v1\/boards\/([^/]+)$/)) && method === 'GET') {
      var board = scores.getBoard(db, decodeURIComponent(m[1]));
      if (!board) return send(req, res, 404, { error: 'unknown code' }, origin);
      return send(req, res, 200, board, origin);
    }
    if ((m = path.match(/^\/v1\/players\/([^/]+)$/))) {
      var code = decodeURIComponent(m[1]);
      if (method === 'GET') {
        var found = scores.getPlayer(db, code);
        if (!found) return send(req, res, 404, { error: 'unknown code' }, origin);
        return send(req, res, 200, found, origin);
      }
      if (method === 'PUT') {
        if (!allowed('bests', req, res)) return;
        return json(req, res, 200, function (patch) { return scores.raiseBests(db, code, patch); });
      }
    }

    /* ---- accounts (see accounts.js) ---- */
    if (method === 'POST' && path === '/v1/accounts') {
      if (!allowed('accounts', req, res)) return;
      return json(req, res, 201, function (body) { return accounts.createAccount(db, body); });
    }
    if (method === 'POST' && path === '/v1/links/use') {
      if (!allowed('signin', req, res)) return;
      return json(req, res, 201, function (body) { return accounts.useLink(db, body, clock()); });
    }
    if (method === 'POST' && path === '/v1/recover') {
      if (!allowed('signin', req, res)) return;
      return json(req, res, 201, function (body) { return accounts.recover(db, body); });
    }
    if (path === '/v1/me' || path.indexOf('/v1/me/') === 0) {
      if (!(w = who(req, res))) return;
      if (method === 'GET' && path === '/v1/me') return send(req, res, 200, accounts.describe(db, w), origin);
      if (method === 'PATCH' && path === '/v1/me') return json(req, res, 200, function (body) { return accounts.rename(db, w, body.name); });
      if (method === 'PUT' && path === '/v1/me/bests') {
        if (!allowed('bests', req, res)) return;
        return json(req, res, 200, function (patch) { return accounts.raiseBests(db, w, patch); });
      }
      if (method === 'POST' && path === '/v1/me/fold') return json(req, res, 200, function (body) { return accounts.foldCode(db, w, body.code); });
      if (method === 'POST' && path === '/v1/me/links') {
        if (!allowed('links', req, res)) return;
        return json(req, res, 201, function () { return accounts.makeLink(db, w, clock()); });
      }
      if (method === 'POST' && path === '/v1/me/recovery') {
        if (!allowed('links', req, res)) return;
        return json(req, res, 201, function () { return accounts.newRecovery(db, w); });
      }
      if (method === 'DELETE' && (m = path.match(/^\/v1\/me\/devices\/([^/]+)$/))) {
        req.resume();
        try { return send(req, res, 200, accounts.removeDevice(db, w, decodeURIComponent(m[1])), origin); }
        catch (e) { return send(req, res, e.status || 400, { error: e.message }, origin); }
      }
    }
    send(req, res, 404, { error: 'not found' }, origin);
  });
}

module.exports = { createScoresServer: createScoresServer };
