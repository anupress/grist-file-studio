// The first bytes of a file, when that is all that is wanted (a photo's EXIF is in its first 64 kB). Grist ignores byte ranges, so the whole
// file is requested and the request is cancelled once enough has arrived: the rest of a 6 MB photo is not read.

/**
 * @param res a fetch Response
 * @param n how many bytes are wanted
 * @param stop called once there are enough, to cancel the request
 * @returns {Promise<Uint8Array>} at most n bytes
 */
export async function readHead(res, n, stop) {
  if (!res.body) return new Uint8Array(await res.blob().then((b) => b.slice(0, n).arrayBuffer()));
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  try {
    while (got < n) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
  } finally {
    if (stop) stop();
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const out = new Uint8Array(Math.min(got, n));
  let at = 0;
  for (const c of chunks) { const take = Math.min(c.length, out.length - at); out.set(c.subarray(0, take), at); at += take; if (at >= out.length) break; }
  return out;
}
