// Reading a zip file: enough to open a Word, Excel, PowerPoint or OpenDocument file and take text out of it.
//
// Those are zip files with XML inside. The browser can inflate a deflate stream itself (DecompressionStream), so no
// library is needed: read the central directory at the end of the file, find the entry, slice its bytes, inflate.
// Not supported, and said so by throwing: zip64 archives, encrypted entries, methods other than stored and deflate.

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

/** @returns {Promise<{names: string[], has(name), bytes(name, max), text(name, max)}>} */
export async function readZip(blob) {
  const size = blob.size;
  const tailStart = Math.max(0, size - 65557);   // the end-of-directory record is within 64 kB of the end
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) { at = i; break; }
  if (at < 0) throw new Error('Not a zip file.');
  const eocd = new DataView(tail.buffer, tail.byteOffset + at, tail.length - at);
  const count = u16(eocd, 10), cdSize = u32(eocd, 12), cdOffset = u32(eocd, 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('Zip64 files are not supported.');
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const flags = u16(cd, p + 8), method = u16(cd, p + 10), csize = u32(cd, p + 20), usize = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32), offset = u32(cd, p + 42);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    entries.set(name, { name, flags, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  async function bytes(name, max = Infinity) {
    const e = entries.get(name);
    if (!e) throw new Error(`No ${name} in the zip file.`);
    if (e.flags & 1) throw new Error('Encrypted zip entries are not supported.');
    const head = new DataView(await blob.slice(e.offset, e.offset + 30).arrayBuffer());
    if (u32(head, 0) !== 0x04034b50) throw new Error('A damaged zip entry.');
    const start = e.offset + 30 + u16(head, 26) + u16(head, 28);
    const data = blob.slice(start, start + e.csize);
    if (e.method === 0) return new Uint8Array(await data.slice(0, Math.min(e.csize, max)).arrayBuffer());
    if (e.method !== 8) throw new Error(`Zip method ${e.method} is not supported.`);
    const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (got >= max) { await reader.cancel(); break; }   // enough: the rest of a huge sheet is not needed
    }
    const out = new Uint8Array(Math.min(got, max));
    let o = 0;
    for (const c of chunks) { const take = Math.min(c.length, out.length - o); out.set(c.subarray(0, take), o); o += take; if (o >= out.length) break; }
    return out;
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    bytes,
    text: async (name, max = 4e6) => decoder.decode(await bytes(name, max)),
  };
}
