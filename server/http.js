'use strict';
var http = require('http');
var scores = require('./scores.js');
var limits = require('./limits.js');

var MAX_BODY = 8192;

function send(req, res, status, body, origin, extra) {
  var headers = { 'content-type': 'application/json; charset=utf-8' };
  for (var k in (extra || {})) headers[k] = extra[k];
  if (origin && req.headers.origin === origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-methods'] = 'GET, POST, PUT, OPTIONS';
    headers['access-control-allow-headers'] = 'content-type';
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

/** opts: { db, origin, limits (rules for limits.js; tests pass small ones), now (a clock, tests) } */
function createScoresServer(opts) {
  var db = opts.db;
  var origin = opts.origin || '';
  var limiter = limits.createLimiter(opts.limits, opts.now);
  /** True when this post may go ahead; otherwise sends 429 and returns false. */
  function allowed(name, req, res) {
    var r = limiter.check(name, limits.clientAddress(req));
    if (r.ok) return true;
    req.resume();   // drop the body
    send(req, res, 429, { error: 'too many requests' }, origin, { 'retry-after': String(r.retryAfter) });
    return false;
  }
  return http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') return send(req, res, 204, null, origin);
    if (req.method === 'GET' && url.pathname === '/health') return send(req, res, 200, { ok: true }, origin);
    if (req.method === 'POST' && url.pathname === '/v1/players') {
      if (!allowed('players', req, res)) return;
      return send(req, res, 201, scores.createPlayer(db), origin);
    }
    if (req.method === 'POST' && url.pathname === '/v1/boards') {
      if (!allowed('boards', req, res)) return;
      readBody(req).then(function (text) {
        var body;
        try { body = JSON.parse(text || '{}'); }
        catch (e) { return send(req, res, 400, { error: 'invalid json' }, origin); }
        var saved;
        try { saved = scores.saveBoard(db, body); }
        catch (e) { return send(req, res, 400, { error: e.message }, origin); }
        return send(req, res, 201, saved, origin);
      }).catch(function (e) {
        if (!res.headersSent) send(req, res, e.status || 400, { error: e.message }, origin);
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/runs') {
      if (!allowed('runs', req, res)) return;
      readBody(req).then(function (text) {
        var body;
        try { body = JSON.parse(text || '{}'); }
        catch (e) { return send(req, res, 400, { error: 'invalid json' }, origin); }
        try { scores.countRunEnd(db, body); }
        catch (e) { return send(req, res, 400, { error: e.message }, origin); }
        return send(req, res, 201, { ok: true }, origin);
      }).catch(function (e) {
        if (!res.headersSent) send(req, res, e.status || 400, { error: e.message }, origin);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/runs') {
      var wanted = url.searchParams.get('version');
      var ver = wanted == null ? null : Number(wanted);
      if (ver !== null && !(Number.isInteger(ver) && ver >= 1 && ver <= 9999)) return send(req, res, 400, { error: 'invalid version' }, origin);
      return send(req, res, 200, { runs: scores.runEnds(db, ver) }, origin);
    }
    var boardMatch = url.pathname.match(/^\/v1\/boards\/([^/]+)$/);
    if (boardMatch && req.method === 'GET') {
      var board = scores.getBoard(db, decodeURIComponent(boardMatch[1]));
      if (!board) return send(req, res, 404, { error: 'unknown code' }, origin);
      return send(req, res, 200, board, origin);
    }
    var match = url.pathname.match(/^\/v1\/players\/([^/]+)$/);
    if (!match) return send(req, res, 404, { error: 'not found' }, origin);
    var code = decodeURIComponent(match[1]);
    if (req.method === 'GET') {
      var found = scores.getPlayer(db, code);
      if (!found) return send(req, res, 404, { error: 'unknown code' }, origin);
      return send(req, res, 200, found, origin);
    }
    if (req.method === 'PUT') {
      if (!allowed('bests', req, res)) return;
      readBody(req).then(function (text) {
        var patch;
        try { patch = JSON.parse(text || '{}'); }
        catch (e) { return send(req, res, 400, { error: 'invalid json' }, origin); }
        var raised;
        try { raised = scores.raiseBests(db, code, patch); }
        catch (e) { return send(req, res, 400, { error: e.message }, origin); }
        if (!raised) return send(req, res, 404, { error: 'unknown code' }, origin);
        return send(req, res, 200, raised, origin);
      }).catch(function (e) {
        if (!res.headersSent) send(req, res, e.status || 400, { error: e.message }, origin);
      });
      return;
    }
    send(req, res, 404, { error: 'not found' }, origin);
  });
}

module.exports = { createScoresServer: createScoresServer };
