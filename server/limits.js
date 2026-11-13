'use strict';
/* Posting limits: how many times one address may post to each route in a window of time.
   Kept in memory, which is right for one server process (the score service runs one).
   Reading is never limited. This slows down a script hammering the server; it is not a
   security wall, since an address can be faked or changed. */

var DEFAULT_RULES = {
  runs: { max: 30, windowMs: 60 * 1000 },          // run ends
  boards: { max: 20, windowMs: 60 * 1000 },        // dealt boards (puzzle codes)
  bests: { max: 60, windowMs: 60 * 1000 },         // raising bests on a score code
  players: { max: 10, windowMs: 60 * 60 * 1000 },  // new score codes
  accounts: { max: 10, windowMs: 60 * 60 * 1000 }, // new accounts
  links: { max: 20, windowMs: 60 * 60 * 1000 },    // new link codes and recovery keys
  signin: { max: 10, windowMs: 60 * 1000 },        // tries with a link code or recovery key (stops guessing)
  saves: { max: 30, windowMs: 60 * 1000 }          // saved games (the game sends at most one every 5 seconds)
};

/** The address a request came from. Render's front end puts the caller's address first in
    x-forwarded-for; without that header (tests, local runs) it is the socket's address. */
function clientAddress(req) {
  var fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * rules: { name: { max, windowMs } } (default DEFAULT_RULES). now: a clock, for tests.
 * check(name, address) -> { ok: true } or { ok: false, retryAfter: seconds }.
 */
function createLimiter(rules, now) {
  rules = rules || DEFAULT_RULES;
  now = now || Date.now;
  var hits = new Map();   // name|address -> { count, resetAt }
  var checks = 0;
  function sweep(t) {
    hits.forEach(function (h, key) { if (h.resetAt <= t) hits.delete(key); });
  }
  function check(name, address) {
    var rule = rules[name];
    if (!rule) return { ok: true };
    var t = now();
    if (++checks % 1000 === 0) sweep(t);   // forget old addresses now and then, so memory stays small
    var key = name + '|' + address;
    var h = hits.get(key);
    if (!h || h.resetAt <= t) { h = { count: 0, resetAt: t + rule.windowMs }; hits.set(key, h); }
    if (h.count >= rule.max) return { ok: false, retryAfter: Math.max(1, Math.ceil((h.resetAt - t) / 1000)) };
    h.count++;
    return { ok: true };
  }
  return { check: check, size: function () { return hits.size; } };
}

module.exports = { DEFAULT_RULES: DEFAULT_RULES, clientAddress: clientAddress, createLimiter: createLimiter };
