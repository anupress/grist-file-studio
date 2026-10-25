// What kind of file something is, from its extension.
//
// Never from Grist's fileType: Grist leaves it empty for every upload (M0, question 9), so the
// extension Grist keeps in fileExt, or failing that the end of the file name, is all there is.

const KINDS = {
  image: ['jpg', 'jpeg', 'jfif', 'pjpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'apng'],
  // HEIC/HEIF is what iPhones take. Safari draws it; Chrome, Edge and Firefox cannot, so it is a
  // picture only where the browser says it can decode one (decided at run time, see canDraw).
  heic: ['heic', 'heif'],
  pdf: ['pdf'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'],
  audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba'],
  // Shown and edited as text, never run: an HTML file is its source here (and its preview, sandboxed,
  // in the editor).
  text: ['txt', 'csv', 'tsv', 'json', 'md', 'markdown', 'xml', 'log', 'yaml', 'yml', 'ini', 'tex', 'srt', 'vtt',
    'html', 'htm', 'css', 'js', 'mjs', 'ts', 'sql', 'py', 'sh', 'toml', 'conf', 'cfg'],
};
const BY_EXT = new Map(Object.entries(KINDS).flatMap(([kind, exts]) => exts.map((e) => [e, kind])));

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', png: 'image/png', apng: 'image/apng', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif',
  pdf: 'application/pdf',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm',
  txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', md: 'text/markdown', markdown: 'text/markdown',
  xml: 'application/xml', log: 'text/plain', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', yaml: 'text/yaml', yml: 'text/yaml', ini: 'text/plain', tex: 'text/plain', srt: 'text/plain', vtt: 'text/vtt',
  zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** 'IMG_0042.JPG' -> 'jpg'; '.pdf' -> 'pdf'; 'README' -> ''. */
export function extOf(nameOrExt) {
  const s = String(nameOrExt || '').trim().toLowerCase();
  const dot = s.lastIndexOf('.');
  if (dot < 0) return '';
  const ext = s.slice(dot + 1);
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

/** The name without its extension: 'Site plan.final.pdf' -> 'Site plan.final'. */
export function baseOf(name) {
  const s = String(name || '');
  const ext = extOf(s);
  return ext ? s.slice(0, -(ext.length + 1)) : s;
}

/** 'image' | 'heic' | 'pdf' | 'video' | 'audio' | 'text' | 'other' */
export function kindOf(ext) {
  return BY_EXT.get(String(ext || '').toLowerCase().replace(/^\./, '')) || 'other';
}

/** The MIME type a Blob of this file should carry (Grist serves the right one, but a Blob made from bytes has none). */
export function mimeOf(ext) {
  return MIME[String(ext || '').toLowerCase().replace(/^\./, '')] || 'application/octet-stream';
}

/** The filter groups the chips offer; HEIC counts as a picture there. */
export const KIND_GROUPS = ['image', 'pdf', 'video', 'audio', 'other'];
export function groupOf(kind) {
  if (kind === 'heic') return 'image';
  if (kind === 'text') return 'other';
  return KIND_GROUPS.includes(kind) ? kind : 'other';
}

/** Short label for a file-type tile: 'PDF', 'DOCX', 'MP4'; 'FILE' when there is no extension. */
export function typeLabel(ext) {
  const e = String(ext || '').replace(/^\./, '');
  return e ? e.toUpperCase().slice(0, 5) : 'FILE';
}

/**
 * The tile colour family for a file type, so a wall of documents is told apart by more than its
 * label: red for PDF, blue for word processing, green for spreadsheets, orange for slides, and so on.
 * Always shown together with the type label, never as the only sign.
 */
export function tintOf(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') return 'red';
  if (/^(docx?|odt|rtf|pages)$/.test(e)) return 'blue';
  if (/^(xlsx?|ods|csv|tsv|numbers)$/.test(e)) return 'green';
  if (/^(pptx?|odp|key)$/.test(e)) return 'orange';
  if (/^(zip|rar|7z|gz|tar|tgz)$/.test(e)) return 'grey';
  const k = kindOf(e);
  if (k === 'video') return 'violet';
  if (k === 'audio') return 'teal';
  if (k === 'text') return 'slate';
  return 'slate';
}

/** Bytes as people read them: 812 B, 14 kB, 3.4 MB, 1.2 GB (decimal units, as Windows Explorer and macOS Finder do not agree, Finder's). */
export function sizeText(bytes, locale = 'en') {
  const n = Number(bytes) || 0;
  const fmt = (v, d) => new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(v);
  if (n < 1000) return `${fmt(n, 0)} B`;
  if (n < 1e6) return `${fmt(n / 1e3, n < 1e4 ? 1 : 0)} kB`;
  if (n < 1e9) return `${fmt(n / 1e6, n < 1e7 ? 1 : 0)} MB`;
  return `${fmt(n / 1e9, 1)} GB`;
}
