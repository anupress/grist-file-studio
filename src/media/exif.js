// What a photo says about itself: when it was taken, with what, and (if the phone was told it may) where. Read from the EXIF block at the
// start of a JPEG; nothing else is read and nothing is written back. Other kinds of picture have no such block here and give null.
//
// The time is the one the camera wrote, as a wall clock without a time zone ("2026:10:02 14:31:07"): it is kept as the milliseconds of that
// clock read as UTC, which sorts photos in the order they were taken and formats back to the same time with timeZone 'UTC'.

const ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5;
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * @param bytes the first bytes of a file (64 kB is plenty)
 * @returns {null | {taken: number|null, make: string, model: string, orientation: number|null, lat: number|null, lon: number|null, altitude: number|null}}
 */
export function parseExif(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 12 || u[0] !== 0xff || u[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= u.length) {
    if (u[at] !== 0xff) return null;
    const marker = u[at + 1];
    if (marker === 0xda || marker === 0xd9) return null;   // the picture itself starts: no EXIF before it
    const len = (u[at + 2] << 8) | u[at + 3];
    if (marker === 0xe1 && u[at + 4] === 0x45 && u[at + 5] === 0x78 && u[at + 6] === 0x69 && u[at + 7] === 0x66 && u[at + 8] === 0 && u[at + 9] === 0) {
      return parseTiff(u.subarray(at + 10, Math.min(u.length, at + 2 + len)));
    }
    at += 2 + len;
  }
  return null;
}

/**
 * The same, for a HEIC or HEIF file (an iPhone's): the EXIF block is an "item" of the file, found through its `meta` box (`iinf` says which
 * item is 'Exif', `iloc` says where its bytes are). Those bytes must lie inside `bytes`; when the block sits further on than what was read,
 * the answer is null (a photo without a date, as far as this reader can tell).
 */
export function parseHeicExif(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const u32 = (o) => dv.getUint32(o);
  const u16 = (o) => dv.getUint16(o);
  const tag = (o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  /** The boxes between a and b: [{type, start (of the box), body (after its header), end}] */
  const boxes = (a, b) => {
    const out = [];
    while (a + 8 <= b) {
      let size = u32(a), head = 8;
      if (size === 1) { if (a + 16 > b) break; size = Number(dv.getBigUint64(a + 8)); head = 16; } else if (size === 0) size = b - a;
      if (size < head) break;
      out.push({ type: tag(a + 4), start: a, body: a + head, end: Math.min(b, a + size) });
      a += size;
    }
    return out;
  };
  try {
    const top = boxes(0, u.length);
    if (!top.length || top[0].type !== 'ftyp') return null;
    const meta = top.find((b) => b.type === 'meta');
    if (!meta) return null;
    const inner = boxes(meta.body + 4, meta.end);   // a FullBox: four bytes of version and flags first
    const iinf = inner.find((b) => b.type === 'iinf');
    const iloc = inner.find((b) => b.type === 'iloc');
    if (!iinf || !iloc) return null;
    // which item is the Exif one
    const ver = u[iinf.body];
    let at = iinf.body + 4 + (ver === 0 ? 2 : 4);
    let exifId = null;
    for (const infe of boxes(at, iinf.end)) {
      if (infe.type !== 'infe') continue;
      const v = u[infe.body];
      if (v < 2) continue;
      const idAt = infe.body + 4;
      const id = v === 2 ? u16(idAt) : u32(idAt);
      const typeAt = idAt + (v === 2 ? 2 : 4) + 2;
      if (tag(typeAt) === 'Exif') { exifId = id; break; }
    }
    if (exifId == null) return null;
    // where its bytes are
    const lv = u[iloc.body];
    const sizes = u[iloc.body + 4], more = u[iloc.body + 5];
    const offSize = sizes >> 4, lenSize = sizes & 15, baseSize = more >> 4, indexSize = lv === 1 || lv === 2 ? more & 15 : 0;
    let p = iloc.body + 6;
    const count = lv < 2 ? u16(p) : u32(p);
    p += lv < 2 ? 2 : 4;
    const read = (n, o) => (n === 0 ? 0 : n === 4 ? u32(o) : n === 8 ? Number(dv.getBigUint64(o)) : n === 2 ? u16(o) : u[o]);
    for (let i = 0; i < count; i++) {
      const id = lv < 2 ? u16(p) : u32(p);
      p += lv < 2 ? 2 : 4;
      let method = 0;
      if (lv === 1 || lv === 2) { method = u16(p) & 15; p += 2; }
      p += 2;   // data reference index
      const base = read(baseSize, p); p += baseSize;
      const extents = u16(p); p += 2;
      let first = null;
      for (let k = 0; k < extents; k++) {
        if (indexSize) p += indexSize;
        const off = read(offSize, p); p += offSize;
        const len = read(lenSize, p); p += lenSize;
        if (k === 0) first = { off: base + off, len };
      }
      if (id !== exifId) continue;
      if (method !== 0 || !first || first.len < 12 || first.off + first.len > u.length) return null;
      const block = u.subarray(first.off, first.off + first.len);
      const skip = ((block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3]) >>> 0;   // bytes between this number and the TIFF header ("Exif\0\0" is one)
      return parseTiff(block.subarray(4 + skip));
    }
    return null;
  } catch { return null; }   // a file that is not laid out as expected has no readable date
}

/** The EXIF of a JPEG or a HEIC/HEIF file, whichever these bytes are; null for anything else. */
export function parseAnyExif(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length >= 12 && u[0] === 0xff && u[1] === 0xd8) return parseExif(u);
  if (u.length >= 12 && String.fromCharCode(u[4], u[5], u[6], u[7]) === 'ftyp') return parseHeicExif(u);
  return null;
}

function parseTiff(t) {
  if (t.length < 8) return null;
  const little = t[0] === 0x49 && t[1] === 0x49;
  if (!little && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => (o + 2 <= t.length ? dv.getUint16(o, little) : 0);
  const u32 = (o) => (o + 4 <= t.length ? dv.getUint32(o, little) : 0);
  if (u16(2) !== 42) return null;

  /** The entries of the IFD at `off`: Map(tag -> {type, count, valueAt}) */
  const ifd = (off) => {
    const out = new Map();
    if (!off || off + 2 > t.length) return out;
    const n = Math.min(u16(off), 200);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (e + 12 > t.length) break;
      const type = u16(e + 2), count = u32(e + 4);
      const size = (SIZES[type] || 1) * count;
      out.set(u16(e), { type, count, at: size <= 4 ? e + 8 : u32(e + 8) });
    }
    return out;
  };
  const text = (en) => {
    if (!en || en.type !== ASCII || en.at + en.count > t.length) return '';
    let s = '';
    for (let k = 0; k < en.count; k++) { const c = t[en.at + k]; if (!c) break; s += String.fromCharCode(c); }
    return s.trim();
  };
  const short = (en) => (en && en.type === SHORT ? u16(en.at) : null);
  const rational = (en, k) => { if (!en || en.type !== RATIONAL) return null; const d = u32(en.at + k * 8 + 4); return d ? u32(en.at + k * 8) / d : null; };
  const dms = (en) => { const d = rational(en, 0), m = rational(en, 1), s = rational(en, 2); return d == null ? null : d + (m || 0) / 60 + (s || 0) / 3600; };

  const main = ifd(u32(4));
  const pointer = (tag) => (main.get(tag) ? u32(main.get(tag).at) : 0);   // a LONG stored in the entry itself
  const exif = ifd(pointer(0x8769));
  const gps = ifd(pointer(0x8825));
  const stamp = text(exif.get(0x9003)) || text(exif.get(0x9004)) || text(main.get(0x0132));
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(stamp);
  const taken = m && Number(m[1]) > 1970 ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  let lat = dms(gps.get(0x0002)), lon = dms(gps.get(0x0004));
  if (lat != null && text(gps.get(0x0001)).toUpperCase() === 'S') lat = -lat;
  if (lon != null && text(gps.get(0x0003)).toUpperCase() === 'W') lon = -lon;
  if (lat != null && lon != null && lat === 0 && lon === 0) { lat = null; lon = null; }   // a phone that does not know writes 0, 0
  let altitude = rational(gps.get(0x0006), 0);
  if (altitude != null && gps.get(0x0005) && t[gps.get(0x0005).at] === 1) altitude = -altitude;
  return { taken, make: text(main.get(0x010f)), model: text(main.get(0x0110)), orientation: short(main.get(0x0112)), lat, lon, altitude };
}

/** "Apple iPhone 15" from a make and a model, without saying the make twice ("Canon Canon EOS"). */
export function cameraName(make, model) {
  const mk = (make || '').trim(), md = (model || '').trim();
  if (!md) return mk;
  return mk && !md.toLowerCase().startsWith(mk.toLowerCase().split(' ')[0]) ? `${mk} ${md}` : md;
}

/** A link to a place on OpenStreetMap, for a click (never fetched by the widget). */
export const mapLink = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(5)}/${lon.toFixed(5)}`;

/** "48.20849° N, 16.37208° E" */
export const placeText = (lat, lon) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
