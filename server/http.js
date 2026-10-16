'use strict';
var http = require('http');
var scores = require('./scores.js');

var MAX_BODY = 1024;

function send(req, res, status, body, origin) {
  var headers = { 'content-type': 'application/json; charset=utf-8' };
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

function createScoresServer(opts) {
  var db = opts.db;
  var origin = opts.origin || '';
  return http.createServer(function (req, res) {
    var url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'OPTIONS') return send(req, res, 204, null, origin);
    if (req.method === 'GET' && url.pathname === '/health') return send(req, res, 200, { ok: true }, origin);
    if (req.method === 'POST' && url.pathname === '/v1/players') {
      return send(req, res, 201, scores.createPlayer(db), origin);
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
