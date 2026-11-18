'use strict';
/* Designed boards for Daily and Saga, made in the board designer and saved by an admin.

   Slots (where a board plays):
     daily/YYYY-MM-DD/1, /2, /3   three boards a day, easiest first
     saga/<chapter>/<board>        chapter 1..99, board 1..10 (chapters of 10, played in order)

   Anyone may read them. Only someone with the admin key may save or remove them.
   A board is checked with the game's own rules before it is saved: its format (checkDesign) and
   that it can be cleared with its own Adds (designBeatable). */
var crypto = require('crypto');
var L = require('../game-logic.js');

var MAX_DESIGN_BYTES = 8192;

/** A real calendar date written YYYY-MM-DD, or null. */
function dateOf(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  var d = new Date(text + 'T00:00:00Z');
  return isNaN(d) || d.toISOString().slice(0, 10) !== text ? null : text;
}

/** { kind: 'daily', date, n } or { kind: 'saga', chapter, board }, or null for a bad slot name. */
function parseSlot(slot) {
  if (typeof slot !== 'string') return null;
  var m = slot.match(/^daily\/(\d{4}-\d{2}-\d{2})\/([1-3])$/);
  if (m && dateOf(m[1])) return { kind: 'daily', date: m[1], n: Number(m[2]) };
  m = slot.match(/^saga\/([1-9]\d?)\/([1-9]|10)$/);
  if (m) return { kind: 'saga', chapter: Number(m[1]), board: Number(m[2]) };
  return null;
}

function fail(status, message) { return Object.assign(new Error(message), { status: status }); }

/** Save (or replace) the board in a slot. Throws a 400 with a plain reason for a bad slot or board. */
function putDesign(db, slot, design, now) {
  if (!parseSlot(slot)) throw fail(400, 'unknown slot (daily/YYYY-MM-DD/1..3 or saga/<chapter>/<1..10>)');
  var text = JSON.stringify(design);
  if (text.length > MAX_DESIGN_BYTES) throw fail(413, 'board too large');
  var check = L.checkDesign(design);
  if (!check.ok) throw fail(400, check.errors.join(' '));
  if (!L.designBeatable(design)) throw fail(400, 'This board cannot be cleared, even with its Adds.');
  db.prepare('INSERT INTO designs (slot, design, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(slot) DO UPDATE SET design = excluded.design, updated_at = excluded.updated_at')
    .run(slot, text, new Date(now || Date.now()).toISOString());
  return { slot: slot, saved: true };
}

function removeDesign(db, slot) {
  if (!parseSlot(slot)) throw fail(400, 'unknown slot');
  var r = db.prepare('DELETE FROM designs WHERE slot = ?').run(slot);
  return { slot: slot, removed: r.changes > 0 };
}

function rows(db, prefix) {
  return db.prepare("SELECT slot, design, updated_at FROM designs WHERE slot LIKE ? ESCAPE '\\' ORDER BY slot")
    .all(prefix.replace(/[\\%_]/g, '\\$&') + '%')
    .map(function (r) { return { slot: r.slot, design: JSON.parse(r.design), updatedAt: r.updated_at }; });
}

/** A day's boards: { date, boards: [board 1, 2, 3] }, each a design or null when not filled. */
function getDaily(db, date) {
  if (!dateOf(date)) throw fail(400, 'invalid date (YYYY-MM-DD)');
  var boards = [null, null, null];
  rows(db, 'daily/' + date + '/').forEach(function (r) { boards[parseSlot(r.slot).n - 1] = r.design; });
  return { date: date, boards: boards };
}

/** Every Saga board, by chapter: { chapters: [{ chapter, boards: [{ board, design }] }] }, in order. */
function getSaga(db) {
  var byChapter = {};
  rows(db, 'saga/').forEach(function (r) {
    var p = parseSlot(r.slot);
    (byChapter[p.chapter] = byChapter[p.chapter] || []).push({ board: p.board, design: r.design });
  });
  return {
    chapters: Object.keys(byChapter).map(Number).sort(function (a, b) { return a - b; }).map(function (c) {
      return { chapter: c, boards: byChapter[c].sort(function (a, b) { return a.board - b.board; }) };
    })
  };
}

/** For the admin: every slot that starts with prefix ('daily/2026-11', 'saga/', '' for all). */
function listDesigns(db, prefix) {
  if (typeof prefix !== 'string' || !/^[a-z0-9\/-]{0,40}$/.test(prefix)) throw fail(400, 'invalid prefix');
  return { designs: rows(db, prefix) };
}

/* ---- the admin key ----
   Set as TENSPOT_ADMIN_KEY on the score service (Render: Environment). At least 24 characters;
   shorter or missing turns the admin routes off. Sent as "Authorization: Bearer <key>". */
var MIN_KEY = 24;
function adminKeyUsable(key) { return typeof key === 'string' && key.length >= MIN_KEY; }
function sha(x) { return crypto.createHash('sha256').update(String(x)).digest(); }
/** True when `given` is the admin key. Compares fixed-length hashes in constant time. */
function isAdmin(configured, given) {
  if (!adminKeyUsable(configured) || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(sha(configured), sha(given));
}

module.exports = {
  parseSlot: parseSlot, dateOf: dateOf, putDesign: putDesign, removeDesign: removeDesign,
  getDaily: getDaily, getSaga: getSaga, listDesigns: listDesigns,
  adminKeyUsable: adminKeyUsable, isAdmin: isAdmin, MIN_KEY: MIN_KEY
};
