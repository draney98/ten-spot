'use strict';
/* Numbered database changes. The database remembers the number of the last change applied
   (SQLite's user_version). On start-up, every newer change runs in order, each in its own
   transaction, after a backup copy of the database file is made.

   To change the database: ADD a new entry at the end with the next number.
   NEVER edit or reorder an entry that has shipped: live databases have already run it. */

var CHANGES = [
  {
    n: 1,
    name: 'players, boards and run ends',
    // The tables as they were before numbered changes. Written so it does nothing on a database
    // that already has them (the live one), and builds them on a new one.
    up: function (db) {
      db.exec(
        'CREATE TABLE IF NOT EXISTS players (' +
        'code TEXT PRIMARY KEY,' +
        'easy INTEGER NOT NULL DEFAULT 0,' +
        'normal INTEGER NOT NULL DEFAULT 0,' +
        'hard INTEGER NOT NULL DEFAULT 0,' +
        'created_at TEXT NOT NULL,' +
        'updated_at TEXT NOT NULL)'
      );
      var have = db.prepare('PRAGMA table_info(players)').all().map(function (c) { return c.name; });
      ['ramp_easy', 'ramp_normal', 'ramp_hard'].forEach(function (col) {
        if (have.indexOf(col) === -1) db.exec('ALTER TABLE players ADD COLUMN ' + col + ' INTEGER NOT NULL DEFAULT 0');
      });
      db.exec(
        'CREATE TABLE IF NOT EXISTS boards (' +
        'code TEXT PRIMARY KEY,' +
        'board_key TEXT NOT NULL UNIQUE,' +
        'diff TEXT NOT NULL,' +
        'level INTEGER NOT NULL,' +
        'mode TEXT NOT NULL,' +
        'seed INTEGER NOT NULL)'
      );
      db.exec(
        'CREATE TABLE IF NOT EXISTS run_ends (' +
        'version INTEGER NOT NULL,' +
        'start TEXT NOT NULL,' +
        'level INTEGER NOT NULL,' +
        'n INTEGER NOT NULL DEFAULT 0,' +
        'PRIMARY KEY (version, start, level))'
      );
    }
  },
  {
    n: 2,
    name: 'best log',
    // One row every time a best goes up: which score code, which start point, the score,
    // the rules version it was made under and the run it came from (both unknown for old bests).
    // Bests already on the server are copied in as rules version 1, the first ramp.
    up: function (db) {
      db.exec(
        'CREATE TABLE best_log (' +
        'id INTEGER PRIMARY KEY,' +
        'code TEXT NOT NULL,' +
        'start TEXT NOT NULL,' +
        'score INTEGER NOT NULL,' +
        'version INTEGER,' +
        'run TEXT,' +
        'at TEXT NOT NULL)'
      );
      db.exec('CREATE INDEX best_log_code ON best_log (code, start)');
      db.exec('CREATE INDEX best_log_version ON best_log (version, start, score)');
      ['easy', 'normal', 'hard'].forEach(function (start) {
        db.exec("INSERT INTO best_log (code, start, score, version, run, at) " +
          "SELECT code, '" + start + "', ramp_" + start + ", 1, NULL, updated_at FROM players WHERE ramp_" + start + " > 0");
      });
    }
  },
  {
    n: 3,
    name: 'runs already counted',
    // A run end sent with a run id is counted once, even if the page sends it again.
    up: function (db) {
      db.exec('CREATE TABLE run_seen (run TEXT PRIMARY KEY, at TEXT NOT NULL)');
    }
  },
  {
    n: 4,
    name: 'accounts',
    // An account is a display name with a score code of its own (its bests live on that code).
    // Each signed-in device holds a long random key; only its SHA-256 is stored (devices).
    // Link codes add a device for 10 minutes; the recovery key brings an account back.
    // A score code folded into an account points at it (players.linked_to).
    up: function (db) {
      db.exec(
        'CREATE TABLE accounts (' +
        'id TEXT PRIMARY KEY,' +
        'name TEXT NOT NULL,' +
        'code TEXT NOT NULL UNIQUE,' +
        'recovery_hash TEXT NOT NULL,' +
        'created_at TEXT NOT NULL)'
      );
      db.exec(
        'CREATE TABLE devices (' +
        'id TEXT PRIMARY KEY,' +
        'account_id TEXT NOT NULL,' +
        'key_hash TEXT NOT NULL UNIQUE,' +
        'label TEXT NOT NULL,' +
        'created_at TEXT NOT NULL,' +
        'seen_at TEXT NOT NULL)'
      );
      db.exec('CREATE INDEX devices_account ON devices (account_id)');
      db.exec(
        'CREATE TABLE link_codes (' +
        'code_hash TEXT PRIMARY KEY,' +
        'account_id TEXT NOT NULL,' +
        'expires_at INTEGER NOT NULL)'
      );
      db.exec('ALTER TABLE players ADD COLUMN linked_to TEXT');
    }
  }
];

function versionOf(db) { return db.prepare('PRAGMA user_version').get().user_version; }

/** Copy the whole database to `file` (replacing a copy left by an earlier failed start). */
function backup(db, file) {
  var fs = require('fs');
  try { fs.unlinkSync(file); } catch (e) { /* no earlier copy */ }
  db.exec("VACUUM INTO '" + String(file).replace(/'/g, "''") + "'");
}

/**
 * Bring a database up to date. opts.backupBase: the database's file path; a copy is saved as
 * <backupBase>.before-change-<n> before change n runs. Leave it out for an in-memory database.
 * opts.changes: the list to apply (tests). Returns { from, to, backup }.
 * Throws if a change fails; that change is rolled back and later ones are not tried.
 */
function migrate(db, opts) {
  opts = opts || {};
  var list = opts.changes || CHANGES;
  var from = versionOf(db);
  var pending = list.filter(function (c) { return c.n > from; });
  if (!pending.length) return { from: from, to: from, backup: null };
  var copy = null;
  if (opts.backupBase) {
    copy = opts.backupBase + '.before-change-' + pending[0].n;
    backup(db, copy);
  }
  pending.forEach(function (c) {
    db.exec('BEGIN');
    try {
      c.up(db);
      db.exec('PRAGMA user_version = ' + Number(c.n));
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) { /* already rolled back */ }
      throw new Error('database change ' + c.n + ' (' + c.name + ') failed: ' + e.message);
    }
  });
  return { from: from, to: versionOf(db), backup: copy };
}

module.exports = { CHANGES: CHANGES, LATEST: CHANGES[CHANGES.length - 1].n, migrate: migrate, versionOf: versionOf };
