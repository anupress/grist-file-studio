// Getting file contents out of Grist and new files into it.
//
// Everything goes through Grist's REST endpoint for attachments with a short-lived access token from
// docApi.getAccessToken, which a widget with full access may ask for. What M0 measured:
//   - A token lives 15 minutes. An expired or bad one makes fetch() throw "Failed to fetch" (Grist's
//     refusal carries no CORS header), not a 401. Two rival widgets "stop working after a few
//     minutes" for exactly this reason. So a token is renewed after 12 minutes, and any failed fetch
//     is retried once with a brand-new token.
//   - fetch() can read the bytes (Grist answers with Access-Control-Allow-Origin: * when no cookie is
//     sent), which is what thumbnails, video seeking and zips need.
//   - Grist ignores Range, so a video can only seek once it is a Blob.
//   - Upload: one multipart POST, X-Requested-With set (Grist's CSRF guard), progress through XHR.

import { isLive } from './connect.js';
import { docUrlFromBase } from '../model/locations.js';

const g = () => window.grist;
const RENEW_AFTER_MS = 12 * 60 * 1000;
const tokens = { ro: null, rw: null };

async function token(kind = 'ro', fresh = false) {
  const slot = tokens[kind];
  if (!fresh && slot && Date.now() - slot.at < RENEW_AFTER_MS) return slot.p;
  const p = g().docApi.getAccessToken({ readOnly: kind === 'ro' }).then((t) => {
    if (!t || !t.token || !t.baseUrl) throw new Error('Grist gave no access token');
    return t;
  });
  tokens[kind] = { at: Date.now(), p };
  p.catch(() => { if (tokens[kind]?.p === p) tokens[kind] = null; });
  return p;
}

/** The document's own address (for links that open a cell in Grist), or null. */
export async function docUrl() {
  try { return docUrlFromBase((await token('ro')).baseUrl); } catch { return null; }
}

/**
 * A call to the document's REST API with the widget's own token. Resolves {status, body} for any answer Grist gives
 * (a refusal is an answer: 403 means the person may not do it); rejects only when Grist cannot be reached.
 * `write` asks for a token that may change things. A stale token makes fetch throw, so it is tried once more with a new one.
 */
export async function docCall(method, path, { write = false } = {}) {
  const attempt = async (fresh) => {
    const t = await token(write ? 'rw' : 'ro', fresh);
    const res = await fetch(`${t.baseUrl}${path}${path.includes('?') ? '&' : '?'}auth=${encodeURIComponent(t.token)}`, { method, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text.slice(0, 200); }
    return { status: res.status, body };
  };
  try { return await attempt(false); } catch { return attempt(true); }
}

/**
 * What the storage view needs to know about the document: the person's access ('owners', 'editors', 'viewers'), where files
 * are kept ('internal' or 'external'), and the server's host (Grist's hosted service has a 1 GB allowance per document).
 */
export async function storageInfo() {
  const [doc, store] = await Promise.all([docCall('GET', '').catch(() => null), docCall('GET', '/attachments/store').catch(() => null)]);
  let host = '';
  try { host = new URL((await token('ro')).baseUrl).hostname; } catch { /* unknown */ }
  return { access: doc?.status === 200 ? doc.body?.access || null : null, store: store?.status === 200 ? store.body?.type || 'internal' : 'internal', host };
}

/**
 * Ask Grist to delete the files nobody uses. It must first look which ones those are (updateUsed), then delete them
 * (removeUnused, owners only). Resolves {ok: true} or {ok: false, reason: 'owner' | 'failed', status}.
 */
export async function freeUnusedFiles() {
  const look = await docCall('POST', '/attachments/updateUsed', { write: true });
  if (look.status === 403) return { ok: false, reason: 'owner', status: 403 };
  if (look.status >= 400) return { ok: false, reason: 'failed', status: look.status };
  const gone = await docCall('POST', '/attachments/removeUnused', { write: true });
  if (gone.status === 403) return { ok: false, reason: 'owner', status: 403 };
  if (gone.status >= 400) return { ok: false, reason: 'failed', status: gone.status };
  return { ok: true };
}

/** Forget the tokens, so the next request asks Grist for new ones (after an error). */
export function dropTokens() { tokens.ro = null; tokens.rw = null; }

/**
 * A URL for a file, good for the next 12 minutes at least. Build it when it is used, never keep it.
 * @param o {inline: show in the browser rather than download, name: download under this name, fresh: new token}
 */
export async function fileUrl(attId, { inline = false, name = null, fresh = false } = {}) {
  const t = await token('ro', fresh);
  let url = `${t.baseUrl}/attachments/${attId}/download?auth=${encodeURIComponent(t.token)}`;
  if (inline) url += '&inline=1';
  if (name) url += '&name=' + encodeURIComponent(name);
  return url;
}

/**
 * The file's bytes as a Blob of the given type.
 * @param o {type, signal, onProgress(loaded, total)}
 */
export async function fileBlob(attId, { type = '', signal = null, onProgress = null } = {}) {
  const attempt = async (fresh) => {
    const res = await fetch(await fileUrl(attId, { fresh }), { signal });
    if (!res.ok) throw Object.assign(new Error(`Grist answered ${res.status}`), { status: res.status });
    if (!onProgress || !res.body) return res.blob();
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
    return new Blob(chunks);
  };
  let blob;
  try { blob = await attempt(false); }
  catch (e) {
    if (e.name === 'AbortError' || e.status === 404) throw e;
    blob = await attempt(true);   // a stale token, most likely: once more with a new one
  }
  return type && blob.type !== type ? new Blob([blob], { type }) : blob;
}

/**
 * Upload files to the document's attachment store. The files are not in any cell yet: the caller
 * writes the returned ids into one.
 * @param files  File or Blob objects (a Blob needs a name: pass {blob, name})
 * @returns Promise<number[]> the new attachment ids, in the same order
 */
export function uploadFiles(files, { onProgress = null, signal = null } = {}) {
  if (!isLive()) return Promise.reject(new Error('Not connected to Grist.'));
  return token('rw').then((t) => new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) {
      if (f instanceof File) form.append('upload', f, f.name);
      else form.append('upload', f.blob, f.name);
    }
    const xhr = new XMLHttpRequest();
    if (onProgress) xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total || 0);
    xhr.onload = () => {
      if (xhr.status === 200) {
        try { const ids = JSON.parse(xhr.responseText); if (Array.isArray(ids) && ids.length === files.length) return resolve(ids); } catch { /* below */ }
        return reject(Object.assign(new Error('Grist accepted the upload but sent back no file ids.'), { status: 200 }));
      }
      let msg = '';
      try { msg = JSON.parse(xhr.responseText).error || ''; } catch { msg = xhr.responseText.slice(0, 200); }
      reject(Object.assign(new Error(msg || `Grist refused the upload (${xhr.status}).`), { status: xhr.status }));
    };
    // A network error is what a refused CORS preflight looks like: some self-hosted instances sit
    // behind a firewall that blocks it (two French government instances did in 2026).
    xhr.onerror = () => { dropTokens(); reject(Object.assign(new Error('blocked'), { status: 0, blocked: true })); };
    xhr.onabort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.open('POST', `${t.baseUrl}/attachments?auth=${encodeURIComponent(t.token)}`);
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.send(form);
  }));
}
