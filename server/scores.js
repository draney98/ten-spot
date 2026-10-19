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
  db.exec(
    'CREATE TABLE IF NOT EXISTS boards (' +
    'code TEXT PRIMARY KEY,' +
    'board_key TEXT NOT NULL UNIQUE,' +
    'diff TEXT NOT NULL,' +
    'level INTEGER NOT NULL,' +
    'mode TEXT NOT NULL,' +
    'seed INTEGER NOT NULL)'
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

var BOARD_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
var BOARD_DIFFS = { easy: 1, normal: 1, hard: 1 };
var BOARD_MODES = { num: 1, tiles: 1, icons: 1, teams: 1 };

function normalizeBoardCode(input) {
  if (typeof input !== 'string') return null;
  var raw = input.toLowerCase().replace(/[\s-]/g, '');
  if (!/^[0-9a-z]{6}$/.test(raw)) return null;
  return raw;
}

function formatBoardCode(raw) {
  return raw.slice(0, 3) + '-' + raw.slice(3);
}

function boardRow(record) {
  if (!record) return null;
  return {
    code: formatBoardCode(record.code),
    diff: record.diff,
    level: record.level,
    mode: record.mode,
    seed: record.seed
  };
}

function cellToken(cell) {
  if (!cell || typeof cell !== 'object' || typeof cell.v !== 'number' || !Number.isInteger(cell.v)) return null;
  if (cell.solid === true) return cell.v + 's';
  if (cell.solid === false) return cell.v + 'o';
  if (cell.solid != null) return null;
  return String(cell.v);
}

function boardKey(body) {
  var parts = [];
  for (var i = 0; i < body.cells.length; i++) {
    var token = cellToken(body.cells[i]);
    if (token == null) return null;
    parts.push(token);
  }
  return body.diff + '|' + body.level + '|' + body.mode + '|' + parts.join(',');
}

function isUnique(err) {
  return !!(err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || /UNIQUE/i.test(err.message)));
}

function freshBoardCode(db) {
  for (var n = 0; n < 8; n++) {
    var bytes = crypto.randomBytes(6);
    var raw = '';
    for (var i = 0; i < 6; i++) raw += BOARD_ALPHABET[bytes[i] % BOARD_ALPHABET.length];
    if (!db.prepare('SELECT code FROM boards WHERE code = ?').get(raw)) return raw;
  }
  return null;
}

function getBoard(db, code) {
  var raw = normalizeBoardCode(code);
  if (!raw) return null;
  return boardRow(db.prepare('SELECT code, diff, level, mode, seed FROM boards WHERE code = ?').get(raw));
}

/** Store a dealt board. The same opening cells, difficulty, level, and mode
    keep one code. `codes`, when passed, is the list to try (tests). */
function saveBoard(db, body, codes) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid board');
  if (!BOARD_DIFFS[body.diff] || !BOARD_MODES[body.mode]) throw new Error('invalid board');
  if (typeof body.level !== 'number' || !Number.isInteger(body.level) || body.level < 1 || body.level > 99) throw new Error('invalid board');
  if (typeof body.seed !== 'number' || !Number.isInteger(body.seed) || body.seed < 0 || body.seed > 0xffffffff) throw new Error('invalid board');
  if (!Array.isArray(body.cells) || body.cells.length < 1 || body.cells.length > 400) throw new Error('invalid board');
  var key = boardKey(body);
  if (!key) throw new Error('invalid board');
  var existing = db.prepare('SELECT code, diff, level, mode, seed FROM boards WHERE board_key = ?').get(key);
  if (existing) return boardRow(existing);
  var attempt = 0;
  while (attempt < 8) {
    var raw = codes ? codes[attempt] : freshBoardCode(db);
    attempt++;
    if (!raw || !normalizeBoardCode(raw)) throw new Error('invalid board');
    raw = normalizeBoardCode(raw);
    if (db.prepare('SELECT code FROM boards WHERE code = ?').get(raw)) continue;
    try {
      db.prepare('INSERT INTO boards (code, board_key, diff, level, mode, seed) VALUES (?, ?, ?, ?, ?, ?)')
        .run(raw, key, body.diff, body.level, body.mode, body.seed);
      return getBoard(db, raw);
    } catch (err) {
      if (!isUnique(err)) throw err;
      var won = db.prepare('SELECT code, diff, level, mode, seed FROM boards WHERE board_key = ?').get(key);
      if (won) return boardRow(won);
    }
  }
  throw new Error('invalid board');
}

module.exports = {
  openScores: openScores,
  createPlayer: createPlayer,
  getPlayer: getPlayer,
  raiseBests: raiseBests,
  normalizeCode: normalizeCode,
  formatCode: formatCode,
  normalizeBoardCode: normalizeBoardCode,
  formatBoardCode: formatBoardCode,
  getBoard: getBoard,
  saveBoard: saveBoard
};
