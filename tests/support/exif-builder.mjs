// Builds the EXIF block of a JPEG by hand, in either byte order: for the tests of the EXIF reader and for the tool that gives the demo's
// photos a date, a camera and a place.

/** The APP1 segment (marker included), IFD0 with Make, Model, Orientation and pointers to an Exif IFD (a time) and a GPS IFD. */
export function exifSegment({ be = false, make = 'Apple', model = 'iPhone 15', stamp = '2026:10:02 14:31:07', lat = [48, 12, 30.5], latRef = 'N', lon = [16, 22, 19.5], lonRef = 'E', gps = true, altitude = [182, 10], below = false, orientation = 6 } = {}) {
  const enc16 = (v) => (be ? [(v >> 8) & 255, v & 255] : [v & 255, (v >> 8) & 255]);
  const enc32 = (v) => (be ? [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255] : [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
  const str = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  const ifd0Count = 5, exifCount = 1, gpsCount = gps ? 6 : 0;
  const ifd0At = 8, ifd0Len = 2 + ifd0Count * 12 + 4;
  const exifAt = ifd0At + ifd0Len, exifLen = 2 + exifCount * 12 + 4;
  const gpsAt = exifAt + exifLen, gpsLen = gps ? 2 + gpsCount * 12 + 4 : 0;
  const dataAt = gpsAt + gpsLen;
  const data = [];
  const alloc = (bytes) => { const at = dataAt + data.length; data.push(...bytes); return at; };
  const makeAt = alloc(str(make)), modelAt = alloc(str(model)), stampAt = alloc(str(stamp));
  const rat = (list) => list.flatMap(([n, d]) => [...enc32(n), ...enc32(d)]);
  const latAt = gps ? alloc(rat([[lat[0], 1], [lat[1], 1], [Math.round(lat[2] * 100), 100]])) : 0;
  const lonAt = gps ? alloc(rat([[lon[0], 1], [lon[1], 1], [Math.round(lon[2] * 100), 100]])) : 0;
  const altAt = gps ? alloc(rat([altitude])) : 0;
  const entry = (tag, type, count, value) => [...enc16(tag), ...enc16(type), ...enc32(count), ...value];
  const tiff = [be ? 0x4d : 0x49, be ? 0x4d : 0x49, ...enc16(42), ...enc32(ifd0At)];
  tiff.push(...enc16(ifd0Count),
    ...entry(0x010f, 2, make.length + 1, enc32(makeAt)), ...entry(0x0110, 2, model.length + 1, enc32(modelAt)),
    ...entry(0x0112, 3, 1, [...enc16(orientation), 0, 0]), ...entry(0x8769, 4, 1, enc32(exifAt)), ...entry(0x8825, 4, 1, enc32(gps ? gpsAt : 0)), ...enc32(0));
  tiff.push(...enc16(exifCount), ...entry(below ? 0x9004 : 0x9003, 2, stamp.length + 1, enc32(stampAt)), ...enc32(0));
  if (gps) {
    tiff.push(...enc16(gpsCount),
      ...entry(0x0001, 2, 2, [latRef.charCodeAt(0), 0, 0, 0]), ...entry(0x0002, 5, 3, enc32(latAt)),
      ...entry(0x0003, 2, 2, [lonRef.charCodeAt(0), 0, 0, 0]), ...entry(0x0004, 5, 3, enc32(lonAt)),
      ...entry(0x0005, 1, 1, [0, 0, 0, 0]), ...entry(0x0006, 5, 1, enc32(altAt)), ...enc32(0));
  }
  tiff.push(...data);
  const header = [0x45, 0x78, 0x69, 0x66, 0, 0];
  const len = 2 + header.length + tiff.length;
  return Uint8Array.from([0xff, 0xe1, (len >> 8) & 255, len & 255, ...header, ...tiff]);
}

/** A JPEG that is only an EXIF block between the start and the end markers. */
export function tinyJpeg(opts) {
  const seg = exifSegment(opts);
  return Uint8Array.from([0xff, 0xd8, ...seg, 0xff, 0xd9]);
}

/** A real JPEG with an EXIF block put in: right after its JFIF header if it has one, else right after the start marker. */
export function withExif(jpeg, opts) {
  const u = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  if (u[0] !== 0xff || u[1] !== 0xd8) throw new Error('not a JPEG');
  let at = 2;
  // leave an APP0 (JFIF) first, drop an APP1 that is already there
  const parts = [u.subarray(0, 2)];
  while (at + 4 <= u.length && u[at] === 0xff && (u[at + 1] === 0xe0 || u[at + 1] === 0xe1)) {
    const len = (u[at + 2] << 8) | u[at + 3];
    if (u[at + 1] === 0xe0) parts.push(u.subarray(at, at + 2 + len));
    at += 2 + len;
  }
  parts.push(exifSegment(opts), u.subarray(at));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * A HEIC file reduced to what the reader looks at: ftyp, a meta box with iinf (item 1 a picture, item 2 the Exif) and iloc (where each is),
 * and an mdat holding the two. `v1` writes iloc version 1; `exifFirst: false` puts the picture's bytes before the Exif block.
 */
export function tinyHeic(opts = {}, { v1 = false, exifFirst = true, pictureBytes = 100 } = {}) {
  const tiff = exifSegment(opts).subarray(10);
  const exif = Uint8Array.from([0, 0, 0, 6, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);   // the offset to the TIFF header (6: past "Exif\0\0"), then that and the TIFF
  const pic = new Uint8Array(pictureBytes).fill(7);
  const cc = (s) => [...s].map((c) => c.charCodeAt(0));
  const u32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const u16 = (n) => [(n >> 8) & 255, n & 255];
  const box = (type, ...payload) => { const body = payload.flat(); return [...u32(8 + body.length), ...cc(type), ...body]; };
  const infe = (id, type) => box('infe', [2, 0, 0, 0], u16(id), u16(0), cc(type), [0]);
  const iinf = box('iinf', [0, 0, 0, 0], u16(2), infe(1, 'hvc1'), infe(2, 'Exif'));
  const item = (id, off, len) => (v1 ? [...u16(id), ...u16(0), ...u16(0), ...u16(1), ...u32(off), ...u32(len)] : [...u16(id), ...u16(0), ...u16(1), ...u32(off), ...u32(len)]);
  const iloc = (picAt, exifAt) => box('iloc', [v1 ? 1 : 0, 0, 0, 0], [0x44, 0x00], u16(2), item(1, picAt, pic.length), item(2, exifAt, exif.length));
  const ftyp = box('ftyp', cc('heic'), u32(0), cc('mif1'), cc('heic'));
  const metaLen = box('meta', [0, 0, 0, 0], iinf, iloc(0, 0)).length;
  const first = ftyp.length + metaLen + 8;
  const picAt = exifFirst ? first + exif.length : first, exifAt = exifFirst ? first : first + pic.length;
  const meta = box('meta', [0, 0, 0, 0], iinf, iloc(picAt, exifAt));
  const mdat = box('mdat', exifFirst ? [...exif, ...pic] : [...pic, ...exif]);
  return { bytes: Uint8Array.from([...ftyp, ...meta, ...mdat]), exifAt, exifLength: exif.length };
}
