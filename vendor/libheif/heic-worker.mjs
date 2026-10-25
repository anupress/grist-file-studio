// A worker that decodes HEIC/HEIF pictures (what iPhones take) with libheif, which sits next to it as libheif-bundle.mjs (libheif and libde265,
// compiled to WebAssembly by libheif-js 1.23.5, GNU LGPL 3.0; see NOTICE.txt). This file is File Studio's own and only talks to it.
//
// In:  {id, buffer}          the bytes of one file (transferred)
// Out: {id, width, height, buffer}   the first picture as RGBA, upright (libheif applies the rotation and mirroring stored in the file); or {id, error}

import libheifFactory from './libheif-bundle.mjs';

let ready = null;
/** libheif is ready when its module object has the decoder (the factory may return the module itself or a promise of it). */
function libheif() {
  if (!ready) {
    ready = (async () => {
      const lib = libheifFactory();
      for (let i = 0; i < 400 && !(lib && lib.HeifDecoder); i++) await new Promise((r) => setTimeout(r, 25));
      if (!lib || !lib.HeifDecoder) throw new Error('The HEIC reader did not start.');
      return lib;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

self.onmessage = async (e) => {
  const { id, buffer } = e.data;
  try {
    const lib = await libheif();
    const decoder = new lib.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buffer));
    if (!images || !images.length) throw new Error('There is no picture in this file.');
    const image = images[0];
    const width = image.get_width(), height = image.get_height();
    if (!(width > 0 && height > 0)) throw new Error('This picture has no size.');
    const data = new Uint8ClampedArray(width * height * 4);
    await new Promise((resolve, reject) => image.display({ data, width, height }, (out) => (out ? resolve() : reject(new Error('This picture could not be decoded.')))));
    try { image.free?.(); } catch { /* freed already */ }
    self.postMessage({ id, width, height, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err).slice(0, 200) });
  }
};
