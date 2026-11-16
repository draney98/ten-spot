/* tiles-core.js: the parts of the tile sheet tool (tools/tiles.html) that don't touch the page.
   Works in the browser (window.TenSpotTiles) and in node (tests).
   - layout(cols, rows, cell): where each tile sits on a sheet.
   - cutBoxes(width, height, cols, rows, inset): where to cut each tile out of a sheet that came back,
     even if the image AI changed its size or shape (the proportions of the layout are kept).
   - clearBackground(rgba, w, h, tolerance): make a day tile's paper see-through.
   - edgeColour(rgba, w, h): the typical colour around a tile's edge (a night tile's background).
   - zip(files): a .zip file (stored, not compressed) from [{ name, bytes }].
   - crc32(bytes): the checksum zip files need. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TenSpotTiles = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** The gap between cells, as a share of a cell. Plain gaps make the grid easy for an image AI to keep.
      The page uses 4 x 4 (a square sheet: day tiles in rows 1-2, night in rows 3-4), since image AIs
      handle square pictures best; these functions work for any grid. */
  var GAP = 1 / 8;
  /** Final tile size in the game, in pixels. */
  var TILE = 96;

  /** Sheet layout: cols x rows cells of `cell` pixels with a gap around and between them.
      { width, height, gap, cells: [{ col, row, x, y, size }] } in reading order. */
  function layout(cols, rows, cell) {
    var gap = Math.round(cell * GAP), cells = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) cells.push({ col: c, row: r, x: gap + c * (cell + gap), y: gap + r * (cell + gap), size: cell });
    }
    return { width: cols * cell + (cols + 1) * gap, height: rows * cell + (rows + 1) * gap, gap: gap, cells: cells };
  }

  /** Where each tile is on a sheet of any size with the same proportions as layout().
      inset: share of a cell to trim from each side (0 to 0.25), for an AI that drew past the edges or
      left a border. Boxes may be wider than tall if the AI stretched the sheet; they are cut and squared. */
  function cutBoxes(width, height, cols, rows, inset) {
    inset = Math.max(0, Math.min(0.25, inset || 0));
    var cw = width / (cols + (cols + 1) * GAP), ch = height / (rows + (rows + 1) * GAP);
    var gw = cw * GAP, gh = ch * GAP, boxes = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = gw + c * (cw + gw), y = gh + r * (ch + gh);
        boxes.push({ col: c, row: r, x: x + inset * cw, y: y + inset * ch, w: cw * (1 - 2 * inset), h: ch * (1 - 2 * inset) });
      }
    }
    return boxes;
  }

  /** Median colour of a ring of pixels `ring` in from the edge (0 = the outermost): [r, g, b]. */
  function edgeColour(rgba, w, h, ring) {
    var k = ring || 0, rs = [], gs = [], bs = [];
    function take(x, y) { var i = (y * w + x) * 4; rs.push(rgba[i]); gs.push(rgba[i + 1]); bs.push(rgba[i + 2]); }
    for (var x = k; x < w - k; x++) { take(x, k); take(x, h - 1 - k); }
    for (var y = k + 1; y < h - 1 - k; y++) { take(k, y); take(w - 1 - k, y); }
    function med(a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1]; }
    return [med(rs), med(gs), med(bs)];
  }

  /** Make the paper around a day tile see-through, in place. Only paper connected to the edge goes,
      so white shine inside a drawing stays. Edges are soft, and the paper's tint is taken out of them so
      they look right on Chalkboard too. tolerance: how far from the paper colour still counts as paper
      (sum of the three channel differences, default 70). Returns the paper colour.
      The paper colour is read a little way in (BAND of the size), and that outer band is always cleared:
      a sheet resized by an AI leaves slivers of the gap colour at the edge of a cut, and the drawing
      only fills the middle 80% of a tile anyway. */
  var BAND = 0.03;
  function clearBackground(rgba, w, h, tolerance) {
    var tol = tolerance || 70, soft = Math.min(14, tol / 3);
    var band = Math.max(1, Math.round(Math.min(w, h) * BAND));
    var paper = edgeColour(rgba, w, h, band), n = w * h;
    var dist = new Float32Array(n), seen = new Uint8Array(n), stack = [];
    for (var i = 0; i < n; i++) {
      var ix = i % w, iy = (i - ix) / w;
      var inBand = ix < band || iy < band || ix >= w - band || iy >= h - band;
      dist[i] = inBand ? 0 : Math.abs(rgba[i * 4] - paper[0]) + Math.abs(rgba[i * 4 + 1] - paper[1]) + Math.abs(rgba[i * 4 + 2] - paper[2]);
    }
    function push(p) { if (!seen[p] && dist[p] < tol) { seen[p] = 1; stack.push(p); } }
    for (var x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      var p = stack.pop(), px = p % w, py = (p - px) / w;
      if (px > 0) push(p - 1);
      if (px < w - 1) push(p + 1);
      if (py > 0) push(p - w);
      if (py < h - 1) push(p + w);
    }
    for (var k = 0; k < n; k++) {
      if (!seen[k]) continue;
      var a = Math.max(0, Math.min(1, (dist[k] - soft) / (tol - soft)));
      var j = k * 4;
      if (a < 0.02) { rgba[j] = rgba[j + 1] = rgba[j + 2] = rgba[j + 3] = 0; continue; }
      for (var ch = 0; ch < 3; ch++) rgba[j + ch] = Math.max(0, Math.min(255, Math.round((rgba[j + ch] - (1 - a) * paper[ch]) / a)));
      rgba[j + 3] = Math.round(a * 255);
    }
    return paper;
  }

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** A zip of [{ name, bytes: Uint8Array }], stored without compression (PNGs are compressed already). */
  function zip(files) {
    var enc = function (s) { var out = []; for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7F); return out; };
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    var TIME = 0, DATE = (2026 - 1980) << 9 | 1 << 5 | 1;   // a fixed date, so the same tiles make the same zip
    files.forEach(function (f) {
      var name = enc(f.name), crc = crc32(f.bytes), size = f.bytes.length;
      var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(TIME), u16(DATE), u32(crc), u32(size), u32(size), u16(name.length), u16(0), name);
      parts.push(new Uint8Array(local), f.bytes);
      central.push([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(TIME), u16(DATE), u32(crc), u32(size), u32(size),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name));
      offset += local.length + size;
    });
    var dir = [].concat.apply([], central);
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(dir.length), u32(offset), u16(0));
    parts.push(new Uint8Array(dir), new Uint8Array(end));
    var total = parts.reduce(function (t, p) { return t + p.length; }, 0), out = new Uint8Array(total), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  /** Read back a stored zip (for tests): [{ name, bytes }]. */
  function unzip(bytes) {
    var files = [], i = 0;
    function u16(p) { return bytes[p] | bytes[p + 1] << 8; }
    function u32(p) { return (bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16 | bytes[p + 3] << 24) >>> 0; }
    while (u32(i) === 0x04034b50) {
      var size = u32(i + 18), nlen = u16(i + 26), xlen = u16(i + 28), name = '';
      for (var k = 0; k < nlen; k++) name += String.fromCharCode(bytes[i + 30 + k]);
      var start = i + 30 + nlen + xlen;
      files.push({ name: name, bytes: bytes.subarray(start, start + size), crc: u32(i + 14) });
      i = start + size;
    }
    return files;
  }

  /** File name for a tile: art/<folder>/<name>-day.png */
  function tileFile(folder, name, solid) {
    return 'art/' + folder + '/' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + (solid ? '-night' : '-day') + '.png';
  }

  return { GAP: GAP, TILE: TILE, BAND: BAND, layout: layout, cutBoxes: cutBoxes, edgeColour: edgeColour, clearBackground: clearBackground,
    crc32: crc32, zip: zip, unzip: unzip, tileFile: tileFile };
});
