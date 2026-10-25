// The photo report's options: what goes on the pages, then where the PDF goes. The summary under the options says how many
// pages it will be, so nobody finds out after the fact that 40 photos at one per page is 40 pages.

import { el } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { layoutReport, PER_PAGE, defaultPage } from '../model/report.js';
import { t, tn } from '../i18n/index.js';

const KEY = 'file-studio-report';
const kept = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const keep = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private window: the choices are not kept */ } };
// A guess at text widths, enough to say "about 3 pages" before any PDF exists.
const guess = (s, size, bold) => s.length * size * (bold ? 0.56 : 0.5);

/**
 * @param o {title, count (photos), photos [{name, w, h}], fields [{label, text}], others [{name, info}], canSave, culture, recordName}
 * @returns Promise<{title, perPage, page, fields, captions, others, action: 'save' | 'download'} | null>
 */
export function reportBox(host, o) {
  return new Promise((resolve) => {
    const prefs = kept();
    const state = {
      perPage: PER_PAGE.includes(prefs.perPage) ? prefs.perPage : 4,
      page: prefs.page === 'letter' || prefs.page === 'a4' ? prefs.page : defaultPage(o.culture),
      fields: o.fields.length ? prefs.fields !== false : false,
      captions: prefs.captions !== false,
      others: o.others.length ? prefs.others !== false : false,
    };
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const title = el('input', { id: 'gs-rp-title', class: 'gs-input', value: o.title || '', spellcheck: false });
    const summary = el('p', { class: 'gs-report__sum', role: 'status', 'aria-live': 'polite' });

    const seg = (label, items, current, pick) => {
      const box0 = el('div', { class: 'gs-seg', role: 'group', 'aria-label': label });
      const btns = items.map(([id, text]) => el('button', { type: 'button', class: 'gs-seg__btn', 'aria-pressed': 'false', onclick: () => { pick(id); mark(id); } }, [text]));
      const mark = (cur) => btns.forEach((b, i) => { const on = items[i][0] === cur; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      box0.append(...btns);
      mark(current);
      return box0;
    };
    const check = (label, key, disabled, hint) => {
      const input = el('input', { type: 'checkbox', checked: state[key], disabled, onchange: () => { state[key] = input.checked; refresh(); } });
      return el('label', { class: 'gs-check gs-report__check', title: hint || null }, [input, label]);
    };

    const spec = () => ({
      page: state.page, perPage: state.perPage, title: title.value || o.recordName || '', subtitle: '—', captions: state.captions,
      fields: state.fields ? o.fields : [], photos: o.photos, others: state.others ? o.others : [], othersTitle: t('Other files'),
    });
    const refresh = () => {
      const pages = layoutReport(spec(), guess).pages.length;
      summary.textContent = tn(o.photos.length, '{n} photo', '{n} photos') + ' · ' + tn(pages, 'about {n} page', 'about {n} pages')
        + (state.others && o.others.length ? ' · ' + tn(o.others.length, '{n} other file listed', '{n} other files listed') : '');
    };

    const field = (labelText, id, control) => el('div', { class: 'gs-field' }, [el('label', { for: id, text: labelText }), control]);
    const grid = el('div', { class: 'gs-report__row' }, [
      el('div', { class: 'gs-field' }, [el('span', { class: 'gs-field__label', id: 'gs-rp-per', text: t('Photos per page') }),
        seg(t('Photos per page'), PER_PAGE.map((n) => [n, String(n)]), state.perPage, (n) => { state.perPage = n; refresh(); })]),
      el('div', { class: 'gs-field' }, [el('span', { class: 'gs-field__label', id: 'gs-rp-page', text: t('Paper') }),
        seg(t('Paper'), [['a4', 'A4'], ['letter', 'Letter']], state.page, (p) => { state.page = p; refresh(); })]),
    ]);

    const download = el('button', { type: 'button', class: 'gs-btn', text: t('Download'), onclick: () => finish('download') });
    const save = el('button', { type: 'submit', class: 'gs-btn gs-btn--primary', text: t('Add to the record'), disabled: !o.canSave, title: o.canSave ? null : t('This document cannot be changed here.') });
    function finish(action) {
      keep({ perPage: state.perPage, page: state.page, fields: o.fields.length ? state.fields : prefs.fields, captions: state.captions, others: o.others.length ? state.others : prefs.others });
      done({ title: title.value.trim() || o.recordName || t('Photo report'), perPage: state.perPage, page: state.page, fields: state.fields, captions: state.captions, others: state.others, action });
    }
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('form', { class: 'gs-dialog gs-dialog--wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-rp-t',
      onsubmit: (e) => { e.preventDefault(); if (o.canSave) finish('save'); } }, [
      el('h2', { id: 'gs-rp-t', text: t('Photo report') }),
      el('p', { text: o.recordName
        ? t('The photos of “{name}” on pages, with the record’s details, as a PDF.', { name: o.recordName })
        : t('The photos you marked on pages, as a PDF.') }),
      field(t('Title'), 'gs-rp-title', title),
      grid,
      el('div', { class: 'gs-report__checks' }, [
        check(t('The record’s details'), 'fields', !o.fields.length, o.fields.length ? null : t('This record has no details to show.')),
        check(t('File names under the photos'), 'captions', false),
        check(o.others.length ? tn(o.others.length, 'List the other file ({n})', 'List the other files ({n})') : t('List the other files'), 'others', !o.others.length, o.others.length ? null : t('There are no other files.')),
      ]),
      summary,
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) }), download, save]),
    ]);
    title.addEventListener('input', refresh);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    refresh();
    (o.canSave ? save : download).focus();
  });
}
