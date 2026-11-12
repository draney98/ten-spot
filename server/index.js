'use strict';
var scores = require('./scores.js');
var api = require('./http.js');

var path = process.env.SCORES_DB || '/var/data/scores.sqlite';
var origin = process.env.SCORES_ORIGIN || '';
var port = Number(process.env.PORT) || 8787;

var db;
try {
  db = scores.openScores(path);
} catch (e) {
  console.error('Could not open score database at ' + path + '. Nothing was changed: a failed database change is rolled back, and a copy taken before it is next to the database file.');
  console.error(e.message);
  process.exit(1);
}

var m = db.migrated;
if (m.to !== m.from) console.log('Database changes ' + (m.from + 1) + ' to ' + m.to + ' applied. Copy of the old database: ' + m.backup);
else console.log('Database is up to date (change ' + m.to + ').');

api.createScoresServer({ db: db, origin: origin }).listen(port, '0.0.0.0', function () {
  console.log('Score server listening on ' + port);
});
