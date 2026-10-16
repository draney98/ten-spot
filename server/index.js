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
  console.error('Could not open score database at ' + path);
  console.error(e.message);
  process.exit(1);
}

api.createScoresServer({ db: db, origin: origin }).listen(port, '0.0.0.0', function () {
  console.log('Score server listening on ' + port);
});
