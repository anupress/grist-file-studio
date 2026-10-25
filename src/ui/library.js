// The storage view: where the document's attachment space goes, and two ways to make room (shrink large photos,
// free the files nobody uses any more), with the biggest files to look at or remove.
//
// It reads and shows; what changes the document is done by the callbacks main.js gives it, so every change there is
// one Grist action (or one call to Grist's own cleanup) and says what it did.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus, openMenu, confirmBox } from './dialog.js';
import { sizeText } from '../model/kinds.js';
import { entriesOf, summarize, shrinkCandidates, fill, defaultLimit, SIDE_CHOICES } from '../model/storage.js';
import { t, tn, uiLang } from '../i18n/index.js';

const KIND_LABELS = { image: 'Pictures', pdf: 'PDFs', video: 'Videos', audio: 'Audio', other: 'Other' };
const KIND_TINT = { image: '--gs-t-blue', pdf: '--gs-t-red', video: '--gs-t-violet', audio: '--gs-t-teal', other: '--gs-t-slate' };
const LIMITS = [[0, 'No limit'], [5e8, '500 MB'], [1e9, '1 GB'], [2e9, '2 GB'], [5e9, '5 GB'], [1e10, '10 GB']];
const PAGE = 25;

const SIDE_KEY = 'file-studio-shrink-side';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private window: not kept */ } },
};

/**
 * @param o {load() -> {rows, usesOf(attId), info: {access, store, host}}, canWrite, limitKey,
 *           onShrink(cands, {maxSide}, {onProgress(done, total, saved), signal}) -> {done, failed, saved},
 *           onFree() -> {ok, reason},
 *           onWhere(entry), onDownload(entry), onRemove(entry) -> Promise<boolean>, onClose()}
 */
export function openLibrary(host, o) {
  let data = null, sum = null, shown = PAGE, busy = false, note = null;
  let side = Number(store.get(SIDE_KEY)) || 2048;
  if (!SIDE_CHOICES.includes(side)) side = 2048;
  let limit = null;

  const close = () => { release(); root.remove(); o.onClose?.(); };
  const body = el('div', { class: 'gs-lib__body' });
  const root = el('div', { class: 'gs-lib', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-lib-t' }, [
    el('div', { class: 'gs-lib__head' }, [
      icon('database'),
      el('h2', { id: 'gs-lib-t', text: t('Storage') }),
      el('span', { class: 'gs-spacer' }),
      el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Close'), title: t('Close (Esc)'), onclick: () => close() }, [icon('close')]),
    ]),
    body,
  ]);
  host.append(root);
  const release = trapFocus(root, () => { if (!busy) close(); });
  body.append(el('p', { class: 'gs-hint', role: 'status', text: t('Reading every file in the document…') }));

  const money = (n) => sizeText(n, uiLang());
  const kindWord = (k) => t(KIND_LABELS[k] || 'Other');
  const limitKey = () => `file-studio-limit:${o.limitKey || ''}`;

  async function refresh() {
    data = await o.load();
    sum = summarize(entriesOf(data.rows, data.usesOf));
    const saved = store.get(limitKey());
    limit = saved != null ? Number(saved) || null : defaultLimit(data.info);
    render();
  }

  // ---- the page ----
  function render() {
    const fl = fill(sum.total.bytes, limit);
    const cands = shrinkCandidates(sum.biggest, { maxSide: side });
    const saves = cands.reduce((n, c) => n + c.saves, 0);
    const freeable = sum.unused.bytes;
    const isOwner = data.info.access === 'owners';
    clear(body).append(
      ...(note ? [el('p', { class: 'gs-lib__note', role: 'status', text: note })] : []),
      summaryBlock(fl),
      el('section', { class: 'gs-lib__section', 'aria-labelledby': 'gs-lib-make' }, [
        el('h3', { id: 'gs-lib-make', text: t('Make room') }),
        // 1. shrink photos
        el('div', { class: 'gs-lib__row' }, [
          el('div', { class: 'gs-lib__what' }, [
            el('strong', { text: t('Shrink photos') }),
            el('p', { class: 'gs-hint', text: cands.length
              ? `${tn(cands.length, '{n} photo is larger than it needs to be.', '{n} photos are larger than they need to be.')} ${t('About {size} can be saved.', { size: money(saves) })}`
              : t('No photo is larger than {side} px, or heavy enough to be worth redrawing.', { side }) }),
            el('div', { class: 'gs-lib__side' }, [
              el('span', { class: 'gs-label', text: t('Longest side') }),
              el('div', { class: 'gs-ed__chips', role: 'group', 'aria-label': t('Longest side') }, SIDE_CHOICES.map((px) => el('button', {
                type: 'button', class: 'gs-chip' + (px === side ? ' is-on' : ''), 'aria-pressed': px === side ? 'true' : 'false', text: `${px} px`,
                onclick: () => { side = px; store.set(SIDE_KEY, String(px)); render(); } }))),
            ]),
          ]),
          el('button', { type: 'button', class: 'gs-btn gs-btn--primary', disabled: !cands.length || !o.canWrite || busy,
            title: !o.canWrite ? t('You cannot change this document.') : null, onclick: () => shrink(cands) },
          [icon('image'), cands.length ? tn(cands.length, 'Shrink {n} photo…', 'Shrink {n} photos…') : t('Shrink photos…')]),
        ]),
        // 2. free up space
        el('div', { class: 'gs-lib__row' }, [
          el('div', { class: 'gs-lib__what' }, [
            el('strong', { text: t('Free up space') }),
            el('p', { class: 'gs-hint', text: sum.unused.rows
              ? t('{files} that no cell uses any more; removing them frees {size}. Grist keeps them so that Undo can bring them back; after this, it cannot.', { files: tn(sum.unused.files, '{n} file', '{n} files'), size: money(freeable) })
              : t('Every file in the document is in use. Files you remove or replace show up here until you free them.') }),
            !isOwner && sum.unused.rows ? el('p', { class: 'gs-hint', text: t('Only an owner of the document can free up space.') }) : null,
          ]),
          el('button', { type: 'button', class: 'gs-btn', disabled: !sum.unused.rows || !isOwner || busy, onclick: () => free() }, [icon('trash'), t('Free up space…')]),
        ]),
      ]),
      biggestBlock(),
    );
  }

  function summaryBlock(fl) {
    const unusedPart = sum.unused.bytes;
    const scale = Math.max(limit || 0, sum.total.bytes) || 1;
    const seg = (bytes, cls, style, label) => (bytes > 0 ? el('span', { class: cls, style: { width: Math.max(0.4, (bytes / scale) * 100) + '%', ...style }, title: label }) : null);
    const bar = el('div', { class: 'gs-lib__bar', role: 'img', 'aria-label': t('{used} of {limit}', { used: money(sum.total.bytes), limit: limit ? money(limit) : t('no limit') }) }, [
      ...sum.byKind.map((k) => seg(k.bytes, 'gs-lib__seg', { background: `var(${KIND_TINT[k.kind]})` }, `${kindWord(k.kind)}: ${money(k.bytes)}`)),
      seg(unusedPart, 'gs-lib__seg gs-lib__seg--unused', {}, `${t('Not used any more')}: ${money(unusedPart)}`),
    ]);
    const legend = el('ul', { class: 'gs-lib__legend' }, [
      ...sum.byKind.map((k) => el('li', {}, [el('i', { class: 'gs-lib__dot', style: { background: `var(${KIND_TINT[k.kind]})` } }), el('span', { text: kindWord(k.kind) }), el('b', { text: money(k.bytes) }), el('span', { class: 'gs-lib__n', text: tn(k.files, '{n} file', '{n} files') })])),
      sum.unused.bytes ? el('li', {}, [el('i', { class: 'gs-lib__dot gs-lib__dot--unused' }), el('span', { text: t('Not used any more') }), el('b', { text: money(sum.unused.bytes) }), el('span', { class: 'gs-lib__n', text: tn(sum.unused.files, '{n} file', '{n} files') })]) : null,
    ]);
    const word = fl ? (fl.state === 'over' ? t('Over the limit by {size}', { size: money(sum.total.bytes - limit) }) : fl.state === 'near' ? t('Nearly full: {pct} % of {limit}', { pct: Math.round(fl.pct), limit: money(limit) }) : t('{pct} % of {limit}', { pct: Math.round(fl.pct), limit: money(limit) })) : null;
    const select = el('select', { class: 'gs-input gs-input--inline', 'aria-label': t('Allowance to watch'), onchange: (e) => { limit = Number(e.target.value) || null; store.set(limitKey(), String(limit || 0)); render(); } },
      [...new Set([...LIMITS.map((l) => l[0]), limit || 0])].sort((a, b) => a - b).map((v) => el('option', { value: String(v), selected: (limit || 0) === v, text: v ? money(v) : t('No limit') })));
    return el('section', { class: 'gs-lib__sum', 'aria-label': t('Summary') }, [
      el('div', { class: 'gs-lib__top' }, [
        el('div', {}, [
          el('div', { class: 'gs-lib__big', text: money(sum.total.bytes) }),
          el('div', { class: 'gs-lib__sub', text: `${t('stored for {n}', { n: tn(sum.total.files, '{n} file', '{n} files') })}${data.info.store === 'external' ? ' · ' + t('in external storage') : ''}` }),
        ]),
        el('label', { class: 'gs-lib__limit' }, [el('span', { class: 'gs-label', text: t('Allowance to watch') }), select]),
      ]),
      bar,
      word ? el('p', { class: `gs-lib__fill is-${fl.state}`, text: word }) : null,
      legend,
      el('p', { class: 'gs-hint', text: t('Grist stores a file once, however many cells hold it, so the same photo in two records counts once.') }),
    ]);
  }

  function biggestBlock() {
    const list = sum.biggest.slice(0, shown);
    return el('section', { class: 'gs-lib__section', 'aria-labelledby': 'gs-lib-big' }, [
      el('h3', { id: 'gs-lib-big', text: t('Biggest files') }),
      list.length ? el('table', { class: 'gs-lib__table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: t('Name') }), el('th', { scope: 'col', class: 'is-num', text: t('Size') }), el('th', { scope: 'col', class: 'gs-lib__used', text: t('Used in') }), el('th', { scope: 'col' }, [el('span', { class: 'gs-sr', text: t('Actions') })])])]),
        el('tbody', {}, list.map((b) => {
          const more = el('button', { type: 'button', class: 'gs-icon-btn', 'aria-haspopup': 'menu', 'aria-label': t('More for {name}', { name: b.name }), title: t('More'), onclick: () => openMenu(root, more, [
            [t('Where it is…'), () => o.onWhere(b)],
            [t('Download'), () => o.onDownload(b)],
            null,
            [t('Remove from every place…'), async () => { if (await o.onRemove(b)) { note = t('Removed “{name}”. It is listed under “Free up space” until you free it.', { name: b.name }); await refresh(); } }, { danger: true, disabled: !o.canWrite }],
          ]) }, [icon('menu')]);
          return el('tr', {}, [
            el('td', { class: 'gs-lib__name' }, [el('span', { text: b.name, title: b.name })]),
            el('td', { class: 'is-num', text: money(b.size) }),
            el('td', { class: 'gs-lib__used', text: tn(b.uses, '{n} place', '{n} places') }),
            el('td', { class: 'gs-lib__act' }, [more]),
          ]);
        })),
      ]) : el('p', { class: 'gs-hint', text: t('There are no files in the document yet.') }),
      sum.biggest.length > shown ? el('button', { type: 'button', class: 'gs-btn', text: t('Show {n} more', { n: Math.min(PAGE, sum.biggest.length - shown) }), onclick: () => { shown += PAGE; render(); } }) : null,
    ]);
  }

  // ---- doing things ----
  function progressBox(title) {
    const ctl = new AbortController();
    const text = el('p', { class: 'gs-lib__job-text', role: 'status', text: t('Starting…') });
    const bar = el('div', { class: 'gs-lib__job-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, [el('span')]);
    const stop = el('button', { type: 'button', class: 'gs-btn', text: t('Stop'), onclick: () => { ctl.abort(); stop.disabled = true; text.textContent = t('Stopping after this photo…'); } });
    const scrim = el('div', { class: 'gs-scrim' });
    const box = el('div', { class: 'gs-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [el('h2', { text: title }), text, bar, el('div', { class: 'gs-dialog__foot' }, [stop])]);
    root.append(scrim, box);
    const rel = trapFocus(box, null);
    stop.focus();
    return {
      signal: ctl.signal,
      update(done, total, saved) {
        const pct = total ? Math.round((done / total) * 100) : 0;
        bar.firstChild.style.width = pct + '%';
        bar.setAttribute('aria-valuenow', String(pct));
        text.textContent = t('{done} of {total} photos · {size} saved so far', { done, total, size: money(saved) });
      },
      close() { rel(); scrim.remove(); box.remove(); },
    };
  }

  async function shrink(cands) {
    const total = cands.reduce((n, c) => n + c.saves, 0);
    const ok = await confirmBox(root, {
      title: tn(cands.length, 'Shrink {n} photo?', 'Shrink {n} photos?'),
      body: t('Each is redrawn with its long side at most {side} px (a JPEG at 85 %, a PNG stays a PNG). What the camera wrote into the file, including where the photo was taken, is not kept. About {size} is saved. It is one step, which Undo takes back. The old files stay in the document until you free up space.', { side, size: money(total) }),
      ok: tn(cands.length, 'Shrink {n} photo', 'Shrink {n} photos'),
    });
    if (!ok) return;
    busy = true; render();
    const job = progressBox(t('Shrinking photos'));
    let res;
    try { res = await o.onShrink(cands, { maxSide: side }, { onProgress: (d, n, s) => job.update(d, n, s), signal: job.signal }); }
    catch (e) { res = { done: 0, failed: cands.length, saved: 0, error: String(e?.message || e) }; }
    job.close();
    busy = false;
    note = res.error ? t('Shrinking stopped: {why}', { why: res.error })
      : res.done ? `${tn(res.done, 'Shrunk {n} photo', 'Shrunk {n} photos')}, ${t('{size} smaller', { size: money(res.saved) })}.${res.failed ? ' ' + tn(res.failed, '{n} could not be shrunk [one]', '{n} could not be shrunk') + '.' : ''} ${t('The old files are under “Free up space” until you free them.')}`
      : t('Nothing was shrunk.');
    await refresh();
  }

  async function free() {
    const ok = await confirmBox(root, {
      title: t('Free up space?'),
      body: t('This removes {n} ({size}) that no cell uses. Grist kept them so that Undo could bring them back. Once they are gone, Undo cannot restore them.', { n: tn(sum.unused.files, '{n} file', '{n} files'), size: money(sum.unused.bytes) }),
      ok: t('Free up space'), danger: true,
    });
    if (!ok) return;
    busy = true; render();
    const before = sum.unused.bytes;
    let r;
    try { r = await o.onFree(); } catch { r = { ok: false, reason: 'failed' }; }
    busy = false;
    if (!r.ok) { note = r.reason === 'owner' ? t('Only an owner of the document can free up space.') : t('Grist could not free up space just now. Try again in a moment.'); render(); return; }
    await refresh();
    note = t('Freed about {size}.', { size: money(Math.max(0, before - sum.unused.bytes)) });
    render();
  }

  refresh().catch((e) => { clear(body).append(el('p', { class: 'gs-hint', role: 'alert', text: t('The storage could not be read: {why}', { why: String(e?.message || e) }) })); });
  return { close };
}
