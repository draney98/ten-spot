'use strict';
var crypto = require('crypto');
var { DatabaseSync } = require('node:sqlite');

var ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
var FIELDS = ['easy', 'normal', 'hard'];
var MAX_SCORE = 1000000000;

function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  var raw = input.toLowerCase().replace(/[\s-]/g, '');
  if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{16}$/.test(raw)) return null;
  return raw;
}

function formatCode(raw) {
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16);
}

function rowFrom(record) {
  if (!record) return null;
  return { code: formatCode(record.code), easy: record.easy, normal: record.normal, hard: record.hard };
}

function openScores(path) {
  var db = new DatabaseSync(path, { timeout: 5000 });
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS players (' +
    'code TEXT PRIMARY KEY,' +
    'easy INTEGER NOT NULL DEFAULT 0,' +
    'normal INTEGER NOT NULL DEFAULT 0,' +
    'hard INTEGER NOT NULL DEFAULT 0,' +
    'created_at TEXT NOT NULL,' +
    'updated_at TEXT NOT NULL)'
  );
  return db;
}

function createPlayer(db) {
  var bytes = crypto.randomBytes(16);
  var raw = '';
  for (var i = 0; i < 16; i++) raw += ALPHABET[bytes[i] % ALPHABET.length];
  var now = new Date().toISOString();
  db.prepare('INSERT INTO players (code, easy, normal, hard, created_at, updated_at) VALUES (?, 0, 0, 0, ?, ?)').run(raw, now, now);
  return getPlayer(db, raw);
}

function getPlayer(db, code) {
  var raw = normalizeCode(code);
  if (!raw) return null;
  return rowFrom(db.prepare('SELECT code, easy, normal, hard FROM players WHERE code = ?').get(raw));
}

function raiseBests(db, code, patch) {
  var raw = normalizeCode(code);
  if (!raw) throw new Error('invalid code');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid score');
  var current = db.prepare('SELECT code, easy, normal, hard FROM players WHERE code = ?').get(raw);
  if (!current) return null;
  var next = { easy: current.easy, normal: current.normal, hard: current.hard };
  for (var i = 0; i < FIELDS.length; i++) {
    var key = FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    var n = patch[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_SCORE) throw new Error('invalid score');
    if (n > next[key]) next[key] = n;
  }
  db.prepare('UPDATE players SET easy = ?, normal = ?, hard = ?, updated_at = ? WHERE code = ?')
    .run(next.easy, next.normal, next.hard, new Date().toISOString(), raw);
  return getPlayer(db, raw);
}

module.exports = {
  openScores: openScores,
  createPlayer: createPlayer,
  getPlayer: getPlayer,
  raiseBests: raiseBests,
  normalizeCode: normalizeCode,
  formatCode: formatCode
};
