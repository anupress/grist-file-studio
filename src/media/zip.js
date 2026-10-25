// A zip file written in the browser, without a library.
//
// Photos, PDFs and videos are already compressed, so every entry is STORED (method 0): the zip is
// the files back to back with a header each and a directory at the end. That is all the format
// needs, and every unzipper reads it (Windows Explorer, macOS Archive Utility, 7-Zip, unzip).
// Names are UTF-8 (general purpose flag bit 11), so "Straße – Übergabe.pdf" survives.
//
// The parts are collected as Blobs, never as one big ArrayBuffer: the browser keeps a large Blob on
// disk, so a 2 GB export does not need 2 GB of memory. Classic zip stops at 4 GB and 65,535 entries;
// beyond that this refuses, rather than write a file that some tools cannot open.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of bytes, continuing from `crc` (pass the previous result to feed a file in chunks). */
export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const ZIP_LIMIT = 0xffffffff - 1;
export const ZIP_MAX_ENTRIES = 65535;

/** A Date -> MS-DOS time and date words (local time, 2-second steps, years 1980–2107). */
export function dosDateTime(d = new Date()) {
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function crcOfBlob(blob) {
  // In chunks, so a 300 MB video is not one array.
  let crc = 0;
  const CHUNK = 4 * 1024 * 1024;
  for (let off = 0; off < blob.size; off += CHUNK) {
    const buf = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
    crc = crc32(buf, crc);
  }
  return crc;
}

/**
 * Write a zip.
 * @param entries [{path, blob, date?}]  path uses '/' for folders
 * @param onEntry (doneCount) called after each entry
 * @returns Promise<Blob> of type application/zip
 */
export async function makeZip(entries, { onEntry = null } = {}) {
  if (entries.length > ZIP_MAX_ENTRIES) throw Object.assign(new Error('too many files for one zip'), { code: 'zip-entries' });
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  let done = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const size = e.blob.size;
    if (offset + 30 + name.length + size > ZIP_LIMIT) throw Object.assign(new Error('zip larger than 4 GB'), { code: 'zip-size' });
    const crc = await crcOfBlob(e.blob);
    const { time, date } = dosDateTime(e.date || new Date());
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header
    local.setUint16(4, 20, true);           // version needed: 2.0
    local.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    local.setUint16(8, 0, true);            // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);        // compressed size
    local.setUint32(22, size, true);        // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);           // extra field length
    parts.push(local.buffer, name, e.blob);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);      // central directory header
    cd.setUint16(4, 0x0314, true);          // made by: version 2.0, Unix (so the attributes below are read)
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true);              // extra
    cd.setUint16(32, 0, true);              // comment
    cd.setUint16(34, 0, true);              // disk
    cd.setUint16(36, 0, true);              // internal attributes
    cd.setUint32(38, (0o100644 << 16) >>> 0, true);   // external: a regular file, rw-r--r--
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, name);

    offset += 30 + name.length + size;
    done++;
    onEntry?.(done);
  }
  const cdSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** A CSV the zip carries next to the files: which file came from which record. RFC 4180 quoting. */
export function manifestCsv(rows, header) {
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  // A BOM, so Excel opens the UTF-8 as UTF-8 and the umlauts stay umlauts.
  return '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
