/* Run with:  node tests/tiles.test.js
   The tile sheet tool's core (tools/tiles-core.js): sheet layout, cutting a returned sheet,
   clearing a day tile's paper, and the zip it downloads. The page itself is in browser.test.js. */
'use strict';
var assert = require('assert');
var T = require('../tools/tiles-core.js');

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e.message)); }
}

test('a 4 x 4 sheet of 384 px cells is square, with a gap around and between the cells', function () {
  var L = T.layout(4, 4, 384);
  assert.strictEqual(L.gap, 48);
  assert.deepStrictEqual([L.width, L.height], [4 * 384 + 5 * 48, 4 * 384 + 5 * 48]);
  assert.strictEqual(L.cells.length, 16);
  assert.deepStrictEqual(L.cells[5], { col: 1, row: 1, x: 48 + 432, y: 48 + 432, size: 384 });
});

test('cut boxes find the same cells on the sheet as made, and on a resized or stretched copy', function () {
  var L = T.layout(4, 4, 384);
  T.cutBoxes(L.width, L.height, 4, 4, 0).forEach(function (b, i) {
    var c = L.cells[i];
    assert.ok(Math.abs(b.x - c.x) < 0.5 && Math.abs(b.y - c.y) < 0.5 && Math.abs(b.w - 384) < 0.5 && Math.abs(b.h - 384) < 0.5, 'cell ' + i);
  });
  // shrunk to 1024 and stretched to 1180 wide: every box keeps its share of the sheet
  var s = T.cutBoxes(1180, 1024, 4, 4, 0)[15];
  assert.ok(Math.abs(s.x / 1180 - L.cells[15].x / L.width) < 0.001);
  assert.ok(Math.abs(s.y / 1024 - L.cells[15].y / L.height) < 0.001);
  // trim takes a share off each side
  var t = T.cutBoxes(L.width, L.height, 4, 4, 0.1)[0];
  assert.ok(Math.abs(t.x - (48 + 38.4)) < 0.5 && Math.abs(t.w - 384 * 0.8) < 0.5);
});

function image(w, h, fill) {
  var a = new Uint8ClampedArray(w * h * 4);
  for (var i = 0; i < w * h; i++) { a[i * 4] = fill[0]; a[i * 4 + 1] = fill[1]; a[i * 4 + 2] = fill[2]; a[i * 4 + 3] = 255; }
  return a;
}
function paint(a, w, x0, y0, x1, y1, c) {
  for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { var i = (y * w + x) * 4; a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; }
}
function alpha(a, w, x, y) { return a[(y * w + x) * 4 + 3]; }

test('clearing a day tile: paper goes, the drawing stays, and white shine inside it stays', function () {
  var w = 100, h = 100, a = image(w, h, [242, 246, 234]);
  paint(a, w, 20, 20, 80, 80, [224, 38, 60]);       // a red drawing
  paint(a, w, 30, 30, 40, 40, [255, 255, 255]);     // white shine inside it
  paint(a, w, 0, 0, 100, 2, [201, 216, 181]);       // a sliver of the sheet's green gap at the top edge
  var paper = T.clearBackground(a, w, h, 70);
  assert.deepStrictEqual(paper, [242, 246, 234]);
  assert.strictEqual(alpha(a, w, 0, 0), 0, 'corner');
  assert.strictEqual(alpha(a, w, 50, 1), 0, 'gap sliver at the edge');
  assert.strictEqual(alpha(a, w, 10, 50), 0, 'paper beside the drawing');
  assert.strictEqual(alpha(a, w, 50, 50), 255, 'the drawing');
  assert.strictEqual(alpha(a, w, 35, 35), 255, 'shine inside the drawing');
});

test('the night tile background is the colour around the edge', function () {
  var w = 50, h = 50, a = image(w, h, [63, 9, 17]);
  paint(a, w, 10, 10, 40, 40, [240, 150, 170]);
  assert.deepStrictEqual(T.edgeColour(a, w, h), [63, 9, 17]);
});

test('crc32 matches the standard check value', function () {
  var b = new Uint8Array('123456789'.split('').map(function (c) { return c.charCodeAt(0); }));
  assert.strictEqual(T.crc32(b).toString(16), 'cbf43926');
});

test('the zip holds every file byte for byte, under its game name', function () {
  var files = [
    { name: T.tileFile('arcade-hd', 'Heart', false), bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
    { name: T.tileFile('arcade-hd', 'Heart', true), bytes: new Uint8Array([137, 80, 78, 71, 9]) }
  ];
  assert.strictEqual(files[0].name, 'art/arcade-hd/heart-day.png');
  assert.strictEqual(files[1].name, 'art/arcade-hd/heart-night.png');
  var z = T.zip(files), back = T.unzip(z);
  assert.deepStrictEqual(back.map(function (f) { return f.name; }), files.map(function (f) { return f.name; }));
  back.forEach(function (f, i) {
    assert.deepStrictEqual(Array.from(f.bytes), Array.from(files[i].bytes));
    assert.strictEqual(f.crc, T.crc32(files[i].bytes));
  });
  assert.deepStrictEqual(Array.from(z.subarray(z.length - 22, z.length - 18)), [0x50, 0x4b, 0x05, 0x06], 'ends with the zip directory');
  assert.deepStrictEqual(Array.from(T.zip(files)), Array.from(z), 'the same tiles make the same zip');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
