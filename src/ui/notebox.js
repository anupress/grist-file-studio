// The tags and the note of one file: tags as chips (type one and press Enter or a comma, or pick one already in use), a note under them.
// Resolves {tags, note} when saved, null when cancelled. A person who may not edit sees them and closes.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus } from './dialog.js';
import { cleanTag, mergeTags, withoutTag, MAX_TAG, MAX_NOTE } from '../model/notes.js';
import { t } from '../i18n/index.js';

/**
 * @param o {name, tags, note, suggestions: every tag in use, canEdit}
 * @returns Promise<{tags: string[], note: string} | null>
 */
export function openNoteBox(host, o) {
  return new Promise((resolve) => {
    let tags = o.tags.slice();
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const chips = el('ul', { class: 'gs-tags', 'aria-label': t('Tags') });
    const input = el('input', { class: 'gs-input gs-tags__input', type: 'text', maxlength: MAX_TAG, placeholder: t('Add a tag'), 'aria-label': t('Add a tag'), disabled: !o.canEdit });
    const picks = el('div', { class: 'gs-tags__picks', role: 'group', 'aria-label': t('Tags already in use') });
    const note = el('textarea', { class: 'gs-input gs-note', rows: 4, maxlength: MAX_NOTE, value: o.note, disabled: !o.canEdit, 'aria-label': t('Note'), placeholder: o.canEdit ? t('A few words about this file') : '' });

    function draw() {
      clear(chips).append(...tags.map((tag) => el('li', { class: 'gs-tag' }, [
        el('span', { text: tag }),
        o.canEdit ? el('button', { type: 'button', class: 'gs-tag__x', 'aria-label': t('Remove the tag “{tag}”', { tag }), title: t('Remove'), onclick: () => { tags = withoutTag(tags, tag); draw(); input.focus(); } }, [icon('close')]) : null,
      ])));
      if (!tags.length) chips.append(el('li', { class: 'gs-tags__none', text: o.canEdit ? t('No tags yet') : t('No tags') }));
      clear(picks);
      const free = o.suggestions.filter((s) => !tags.some((x) => x.toLowerCase() === s.toLowerCase())).slice(0, 14);
      if (o.canEdit && free.length) picks.append(el('span', { class: 'gs-tags__label', text: t('In use:') }), ...free.map((s) => el('button', { type: 'button', class: 'gs-chip', onclick: () => { add(s); input.focus(); } }, ['+ ' + s])));
    }
    function add(raw) {
      const tag = cleanTag(raw);
      if (tag) { tags = mergeTags(tags, [tag]); draw(); }
      input.value = '';
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (input.value.trim()) add(input.value); else if (e.key === 'Enter') save(); }
      else if (e.key === 'Backspace' && !input.value && tags.length) { tags = tags.slice(0, -1); draw(); }
    });
    const save = () => { if (input.value.trim()) add(input.value); done({ tags, note: note.value }); };

    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('form', { class: 'gs-dialog gs-dialog--wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-nt-t', onsubmit: (e) => { e.preventDefault(); if (o.canEdit) save(); else done(null); } }, [
      el('h2', { id: 'gs-nt-t', text: t('Tags and note') }),
      el('p', { class: 'gs-note__name', text: o.name, title: o.name }),
      el('div', { class: 'gs-field' }, [el('span', { class: 'gs-field__label', text: t('Tags') }), chips, ...(o.canEdit ? [input, picks] : [])]),
      el('div', { class: 'gs-field' }, [el('label', { for: 'gs-nt-note', text: t('Note') }), note]),
      el('div', { class: 'gs-dialog__foot' }, o.canEdit
        ? [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) }), el('button', { type: 'submit', class: 'gs-btn gs-btn--primary', text: t('Save') })]
        : [el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: t('Close'), onclick: () => done(null) })]),
    ]);
    note.id = 'gs-nt-note';
    draw();
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    (o.canEdit ? input : box.querySelector('button')).focus();
  });
}
