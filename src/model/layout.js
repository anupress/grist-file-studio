// Where every card and tile goes, computed before anything is drawn.
//
// Pictures arrive with their size in Grist's metadata, so the whole wall can be laid out at once and
// nothing jumps when a thumbnail lands. The result is a list of blocks (a record's header, a row of
// tiles, a row of cards) with absolute positions; the view draws only the blocks in sight.
// Pure: tested in tests/layout.test.mjs.

/** Width / height of a file's tile in justified rows. Documents stand like pages, video lies like a screen. */
export function aspectOf(f, fixed = null) {
  const a = fixed && fixed.get ? fixed.get(f.ident) : null;   // the decoded size, when a thumbnail said otherwise
  if (a) return clampAspect(a);
  if (f.kind === 'image' || f.kind === 'heic') return f.w > 0 && f.h > 0 ? clampAspect(f.w / f.h) : 1;   // an SVG has no size in Grist
  if (f.kind === 'pdf') return 0.72;
  if (f.kind === 'video') return 16 / 9;
  if (f.kind === 'audio') return 1.6;
  return 0.8;
}
// A panorama or a strip would make its row so flat (or so tall) that nothing else in it can be seen.
export const clampAspect = (a) => Math.max(0.4, Math.min(3, a || 1));

/**
 * Justified rows: each row is filled to the full width, its height chosen so the tiles keep their
 * shapes. The last row keeps the target height instead of being blown up to fill the width.
 * @param {number[]} aspects
 * @returns {Array<{h: number, items: Array<{i, x, w}>}>}
 */
export function justify(aspects, width, { target = 180, gap = 6, maxH = target * 1.6 } = {}) {
  const rows = [];
  let start = 0;
  while (start < aspects.length) {
    let sum = 0, end = start;
    // Add tiles until the row at the target height would be wider than the space.
    while (end < aspects.length) {
      sum += aspects[end];
      end++;
      if (sum * target + (end - start - 1) * gap >= width) break;
    }
    const n = end - start;
    const full = sum * target + (n - 1) * gap >= width;
    let h = full ? (width - (n - 1) * gap) / sum : target;
    h = Math.min(h, maxH);
    let x = 0;
    const items = [];
    for (let i = start; i < end; i++) {
      const w = i === end - 1 && full && h < maxH ? width - x : aspects[i] * h;   // the last tile absorbs rounding
      items.push({ i, x, w });
      x += w + gap;
    }
    rows.push({ h, items });
    start = end;
  }
  return rows;
}

/** A square grid: as many columns of at least `size` as fit, stretched to the width. */
export function grid(count, width, { size = 180, gap = 6 } = {}) {
  const cols = Math.max(1, Math.floor((width + gap) / (size + gap)));
  const cell = (width - (cols - 1) * gap) / cols;
  const rows = [];
  for (let start = 0; start < count; start += cols) {
    const items = [];
    for (let i = start; i < Math.min(count, start + cols); i++) items.push({ i, x: (i - start) * (cell + gap), w: cell });
    rows.push({ h: cell, items });
  }
  return { cols, cell, rows };
}

export const HEAD_H = 44;     // a record's header in the grouped Files layout
export const CAPTION_H = 22;  // the file name under a tile, when names are shown
export const EMPTY_H = 52;    // the line under the header of a folder with no file

/**
 * The Files layout.
 * @param {Array<{rec, files}>} groups  from visibleFiles(); one group when not grouped
 * @param {{width, size, gap, fit: 'justify'|'square', grouped, captions, pad, fixed}} o
 * @returns {{blocks: Array, height: number}}
 *   block: {kind: 'head', y, h, g} | {kind: 'row', y, h, g, tiles: [{f, x, w, h}]} | {kind: 'empty', y, h, g} (a folder with no file)
 *   (g = the group's index; tiles' h is the picture's height, without the caption)
 */
export function layoutFiles(groups, o) {
  const { width, size = 180, gap = 6, fit = 'justify', grouped = true, captions = false, pad = 12, fixed = null } = o;
  const inner = Math.max(80, width - pad * 2);
  const blocks = [];
  let y = pad;
  const cap = captions ? CAPTION_H : 0;
  groups.forEach((grp, g) => {
    if (grouped) { blocks.push({ kind: 'head', y, h: HEAD_H, g }); y += HEAD_H; }
    if (!grp.files.length) {
      if (grouped) { blocks.push({ kind: 'empty', y, h: EMPTY_H, g }); y += EMPTY_H + 10; }
      return;
    }
    const rows = fit === 'square'
      ? grid(grp.files.length, inner, { size, gap }).rows
      : justify(grp.files.map((f) => aspectOf(f, fixed)), inner, { target: size, gap });
    for (const r of rows) {
      blocks.push({ kind: 'row', y, h: r.h + cap, g, tiles: r.items.map((it) => ({ f: grp.files[it.i], x: pad + it.x, w: it.w, h: r.h })) });
      y += r.h + cap + gap;
    }
    if (grouped) y += 10;
  });
  return { blocks, height: y + pad };
}

/**
 * The Cards layout: a grid of equal cards. The cover is 4:3 of the card's width; under it the title
 * (up to two lines) and one line per field.
 * @returns {{blocks, height, cols, cardW, coverH, bodyH}}
 */
export function layoutCards(count, { width, size = 240, gap = 14, pad = 14, fields = 2, cover = 0.75 }) {
  const inner = Math.max(120, width - pad * 2);
  const { cols, cell, rows } = grid(count, inner, { size, gap });
  const coverH = Math.round(cell * cover);
  const bodyH = 14 + 40 + fields * 20 + (fields ? 4 : 0);
  const blocks = [];
  let y = pad;
  for (const r of rows) {
    blocks.push({ kind: 'cards', y, h: coverH + bodyH, cards: r.items.map((it) => ({ i: it.i, x: pad + it.x, w: it.w })) });
    y += coverH + bodyH + gap;
  }
  return { blocks, height: y - gap + pad, cols, cardW: cell, coverH, bodyH };
}

/** The blocks that overlap [top, bottom], found by binary search (blocks are sorted by y). */
export function visibleBlocks(blocks, top, bottom) {
  let lo = 0, hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].y + blocks[mid].h < top) lo = mid + 1; else hi = mid;
  }
  const out = [];
  for (let i = lo; i < blocks.length && blocks[i].y <= bottom; i++) out.push(blocks[i]);
  return out;
}

/** Where a file sits: its block and tile, for scrolling it into view and for arrow keys. */
export function locate(blocks, key) {
  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    if (blk.kind !== 'row') continue;
    const t = blk.tiles.findIndex((x) => x.f.key === key);
    if (t >= 0) return { b, t, block: blk, tile: blk.tiles[t] };
  }
  return null;
}

/**
 * The file an arrow key moves to. Left and right follow the reading order; up and down pick the tile
 * in the row above or below whose middle is nearest to this one's.
 */
export function neighbour(blocks, key, dir) {
  const at = locate(blocks, key);
  if (!at) return null;
  const rows = blocks.filter((b) => b.kind === 'row');
  const r = rows.indexOf(at.block);
  if (dir === 'left' || dir === 'right') {
    const flat = rows.flatMap((b) => b.tiles);
    const i = flat.indexOf(at.tile) + (dir === 'right' ? 1 : -1);
    return flat[i]?.f.key ?? null;
  }
  const other = rows[r + (dir === 'down' ? 1 : -1)];
  if (!other) return null;
  const mid = at.tile.x + at.tile.w / 2;
  let best = other.tiles[0];
  for (const t of other.tiles) if (Math.abs(t.x + t.w / 2 - mid) < Math.abs(best.x + best.w / 2 - mid)) best = t;
  return best.f.key;
}
