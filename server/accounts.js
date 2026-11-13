'use strict';
/* Accounts with no passwords, emails, texts or passkeys.
   - An account is a display name and a score code of its own; its bests are that code's bests.
   - Each signed-in device holds a device key (43 random characters). The server keeps only its
     SHA-256, so a copy of the database can't be used to sign in.
   - Add a device: a signed-in device asks for a link code (8 characters, 10 minutes, one use).
   - Recovery: a recovery key, shown once at sign-up, signs a new device in and is then replaced.
   - A score code a device already had is folded in: the account takes it over at sign-up, or
     raises its bests with it later; either way the old code then points at the account. */
var crypto = require('crypto');
var scores = require('./scores.js');

var LINK_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
var LINK_MINUTES = 10;
var MAX_LINKS = 3;          // link codes open at once, per account
var MAX_DEVICES = 20;

function sha(text) { return crypto.createHash('sha256').update(String(text)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function randomKey() { return crypto.randomBytes(32).toString('base64url'); }   // 43 characters
function randomId() { return crypto.randomBytes(9).toString('base64url'); }     // 12 characters

/** A display name: 1 to 24 characters after trimming, no control characters. */
function cleanName(name) {
  if (typeof name !== 'string') return null;
  var n = name.replace(/\s+/g, ' ').trim();
  if (!n || n.length > 24 || /[\u0000-\u001f\u007f]/.test(n)) return null;
  return n;
}
/** A device label, for the device list: up to 40 characters, or "A device". */
function cleanLabel(label) {
  var n = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  return n && !/[\u0000-\u001f\u007f]/.test(n) ? n : 'A device';
}
function normalizeLink(input) {
  if (typeof input !== 'string') return null;
  var raw = input.toLowerCase().replace(/[\s-]/g, '');
  return /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/.test(raw) ? raw : null;
}
function formatLink(raw) { return raw.slice(0, 4) + '-' + raw.slice(4); }

function fail(message, status) { return Object.assign(new Error(message), { status: status || 400 }); }

function tx(db, fn) { return scores.atomic(db, fn); }

function addDevice(db, accountId, label) {
  var count = db.prepare('SELECT COUNT(*) AS n FROM devices WHERE account_id = ?').get(accountId).n;
  if (count >= MAX_DEVICES) throw fail('too many devices');
  var key = randomKey(), at = nowIso();
  db.prepare('INSERT INTO devices (id, account_id, key_hash, label, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomId(), accountId, sha(key), cleanLabel(label), at, at);
  return key;
}
function accountRow(db, id) { return db.prepare('SELECT id, name, code FROM accounts WHERE id = ?').get(id); }
function publicAccount(row) { return { name: row.name, code: scores.formatCode(row.code) }; }

/**
 * Make an account. body: { name, label?, code? }. `code` is the score code this device already has:
 * the account takes it over (its bests come along) if it exists and isn't already in an account.
 * Returns { account: { name, code }, key, recovery }. The key and recovery are shown only now.
 */
function createAccount(db, body) {
  body = body || {};
  var name = cleanName(body.name);
  if (!name) throw fail('invalid name');
  var existing = scores.normalizeCode(body.code);
  return tx(db, function () {
    var code = null;
    if (existing) {
      var row = db.prepare('SELECT code, linked_to FROM players WHERE code = ?').get(existing);
      if (row && !row.linked_to) code = row.code;
    }
    if (!code) code = scores.normalizeCode(scores.createPlayer(db).code);
    var id = randomId(), recovery = randomKey();
    db.prepare('INSERT INTO accounts (id, name, code, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, code, sha(recovery), nowIso());
    db.prepare('UPDATE players SET linked_to = ? WHERE code = ?').run(id, code);
    var key = addDevice(db, id, body.label);
    return { account: publicAccount(accountRow(db, id)), key: key, recovery: recovery };
  });
}

/** The account and device for a device key, or null. Marks the device as seen. */
function signedIn(db, key) {
  if (typeof key !== 'string' || key.length < 20 || key.length > 100) return null;
  var d = db.prepare('SELECT id, account_id FROM devices WHERE key_hash = ?').get(sha(key));
  if (!d) return null;
  db.prepare('UPDATE devices SET seen_at = ? WHERE id = ?').run(nowIso(), d.id);
  return { account: accountRow(db, d.account_id), deviceId: d.id };
}

/** Everything the Settings page shows for a signed-in device. */
function describe(db, who) {
  var p = scores.getPlayer(db, who.account.code);
  var devices = db.prepare('SELECT id, label, created_at, seen_at FROM devices WHERE account_id = ? ORDER BY created_at').all(who.account.id)
    .map(function (d) { return { id: d.id, label: d.label, added: d.created_at, seen: d.seen_at, current: d.id === who.deviceId }; });
  return { name: who.account.name, code: p.code, bests: { easy: p.easy, normal: p.normal, hard: p.hard }, devices: devices };
}

function rename(db, who, name) {
  var n = cleanName(name);
  if (!n) throw fail('invalid name');
  db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(n, who.account.id);
  return { name: n };
}

/** A link code for adding a device: { code: 'abcd-2345', expiresAt (ms) }. At most 3 open at once. */
function makeLink(db, who, now) {
  var t = now || Date.now();
  return tx(db, function () {
    db.prepare('DELETE FROM link_codes WHERE expires_at <= ?').run(t);
    var open = db.prepare('SELECT COUNT(*) AS n FROM link_codes WHERE account_id = ?').get(who.account.id).n;
    if (open >= MAX_LINKS) throw fail('too many open links');
    var bytes = crypto.randomBytes(8), raw = '';
    for (var i = 0; i < 8; i++) raw += LINK_ALPHABET[bytes[i] % LINK_ALPHABET.length];
    var expiresAt = t + LINK_MINUTES * 60 * 1000;
    db.prepare('INSERT INTO link_codes (code_hash, account_id, expires_at) VALUES (?, ?, ?)').run(sha(raw), who.account.id, expiresAt);
    return { code: formatLink(raw), expiresAt: expiresAt };
  });
}

/** Sign a new device in with a link code. It works once. Returns { account, key }. */
function useLink(db, body, now) {
  body = body || {};
  var raw = normalizeLink(body.code);
  if (!raw) throw fail('invalid link code');
  var t = now || Date.now();
  return tx(db, function () {
    var row = db.prepare('SELECT account_id, expires_at FROM link_codes WHERE code_hash = ?').get(sha(raw));
    if (row) db.prepare('DELETE FROM link_codes WHERE code_hash = ?').run(sha(raw));
    if (!row || row.expires_at <= t) throw fail('link code not found or expired', 404);
    var key = addDevice(db, row.account_id, body.label);
    return { account: publicAccount(accountRow(db, row.account_id)), key: key };
  });
}

/** Sign a new device in with the recovery key. The key is used up: a new one comes back. */
function recover(db, body) {
  body = body || {};
  if (typeof body.recovery !== 'string' || body.recovery.length < 20 || body.recovery.length > 100) throw fail('invalid recovery key');
  return tx(db, function () {
    var row = db.prepare('SELECT id FROM accounts WHERE recovery_hash = ?').get(sha(body.recovery));
    if (!row) throw fail('recovery key not found', 404);
    var recovery = randomKey();
    db.prepare('UPDATE accounts SET recovery_hash = ? WHERE id = ?').run(sha(recovery), row.id);
    var key = addDevice(db, row.id, body.label);
    return { account: publicAccount(accountRow(db, row.id)), key: key, recovery: recovery };
  });
}

/** A new recovery key; the old one stops working. */
function newRecovery(db, who) {
  var recovery = randomKey();
  db.prepare('UPDATE accounts SET recovery_hash = ? WHERE id = ?').run(sha(recovery), who.account.id);
  return { recovery: recovery };
}

/** Remove a device from the account ('current' = this one: signing out). */
function removeDevice(db, who, deviceId) {
  var id = deviceId === 'current' ? who.deviceId : deviceId;
  var r = db.prepare('DELETE FROM devices WHERE id = ? AND account_id = ?').run(String(id), who.account.id);
  if (!r.changes) throw fail('device not found', 404);
  return { ok: true };
}

/** Raise the account's bests. Same body as PUT /v1/players/:code (with version and run). */
function raiseBests(db, who, patch) {
  var p = scores.raiseBests(db, who.account.code, patch);
  if (!p) throw fail('not found', 404);
  return { easy: p.easy, normal: p.normal, hard: p.hard };
}

/** Fold another score code into the account: its bests raise the account's, and it then points here. */
function foldCode(db, who, code) {
  var raw = scores.normalizeCode(code);
  if (!raw) throw fail('invalid code');
  return tx(db, function () {
    var row = db.prepare('SELECT code, ramp_easy, ramp_normal, ramp_hard, linked_to FROM players WHERE code = ?').get(raw);
    if (!row) throw fail('not found', 404);
    if (row.linked_to && row.linked_to !== who.account.id) throw fail('that code is in another account', 409);
    if (raw !== who.account.code) {
      scores.raiseBests(db, who.account.code, { easy: row.ramp_easy, normal: row.ramp_normal, hard: row.ramp_hard });
      db.prepare('UPDATE players SET linked_to = ? WHERE code = ?').run(who.account.id, raw);
    }
    var p = scores.getPlayer(db, who.account.code);
    return { easy: p.easy, normal: p.normal, hard: p.hard };
  });
}

/* ---- the saved game (one per account) ---- */
var MAX_SAVE = 60000;   // characters; a packed game with a few undo steps is 5 to 20 thousand

/** The account's saved game: { data, savedAt }, or null when there is none. */
function getSave(db, who) {
  var row = db.prepare('SELECT data, saved_at FROM saves WHERE account_id = ?').get(who.account.id);
  return row ? { data: row.data, savedAt: row.saved_at } : null;
}
/**
 * Keep a saved game. body: { data: packed text, savedAt: ms on the device's clock }.
 * A copy older than the one kept is not taken: { kept: false, savedAt: the newer one's time }.
 */
function putSave(db, who, body, now) {
  body = body || {};
  var t = now || Date.now();
  if (typeof body.data !== 'string' || !body.data || body.data.length > MAX_SAVE) throw fail('invalid save');
  if (!Number.isInteger(body.savedAt) || body.savedAt < 0 || body.savedAt > t + 24 * 3600 * 1000) throw fail('invalid save time');
  return tx(db, function () {
    var row = db.prepare('SELECT saved_at FROM saves WHERE account_id = ?').get(who.account.id);
    if (row && row.saved_at > body.savedAt) return { kept: false, savedAt: row.saved_at };
    db.prepare('INSERT INTO saves (account_id, data, saved_at, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (account_id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at, updated_at = excluded.updated_at')
      .run(who.account.id, body.data, body.savedAt, nowIso());
    return { kept: true, savedAt: body.savedAt };
  });
}

module.exports = {
  getSave: getSave, putSave: putSave, MAX_SAVE: MAX_SAVE,
  createAccount: createAccount, signedIn: signedIn, describe: describe, rename: rename,
  makeLink: makeLink, useLink: useLink, recover: recover, newRecovery: newRecovery,
  removeDevice: removeDevice, raiseBests: raiseBests, foldCode: foldCode,
  cleanName: cleanName, normalizeLink: normalizeLink, LINK_MINUTES: LINK_MINUTES
};
