// Panel controls shared by the PDF editor's tabs: a labelled group, a row of chips, colour swatches, a slider.
// They draw with the picture editor's classes (gs-ed__*), so every editor panel looks like one family.

import { el } from '../core/util.js';
import { t } from '../i18n/index.js';

export const group = (label, ...kids) => el('div', { class: 'gs-ed__group' }, [label ? el('div', { class: 'gs-ed__label', text: label }) : null, ...kids]);

/** items: [[id, label, icon?]]. pick(id) is called on a click; the chip for `current` is on. */
export function chips(items, current, pick, { label = '' } = {}) {
  return el('div', { class: 'gs-ed__chips', role: 'group', 'aria-label': label || null }, items.map(([id, text, ic]) => el('button', {
    type: 'button', class: 'gs-chip' + (id === current ? ' is-on' : ''), 'aria-pressed': id === current ? 'true' : 'false', onclick: () => pick(id),
  }, [ic || null, text])));
}

/** colours: [[hex, name]]. */
export function swatches(colors, current, pick, label) {
  return el('div', { class: 'gs-ed__swatches', role: 'group', 'aria-label': label || t('Colour') }, colors.map(([hex, name]) => el('button', {
    type: 'button', class: 'gs-ed__swatch' + (hex.toLowerCase() === String(current).toLowerCase() ? ' is-on' : ''), title: name, 'aria-label': name,
    'aria-pressed': hex.toLowerCase() === String(current).toLowerCase() ? 'true' : 'false', style: { '--sw': hex }, onclick: () => pick(hex),
  })));
}

/**
 * A slider with its name and value. onInput(v) runs while dragging, onChange(v) once when it is let go (or a
 * key is released). `rest` is the value that counts as "not changed", for the accent colour.
 */
export function slider(label, min, max, step, value, { onInput = () => {}, onChange = () => {}, format = (v) => String(v), rest = null } = {}) {
  const out = el('span', { class: 'gs-ed__value', text: format(value) });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label,
    oninput: () => { out.textContent = format(Number(input.value)); mark(); onInput(Number(input.value)); },
    onchange: () => onChange(Number(input.value)) });
  const box = el('div', { class: 'gs-ed__slider' }, [el('label', { class: 'gs-ed__slider-name', text: label }), out, input]);
  const mark = () => box.classList.toggle('is-changed', rest != null && Number(input.value) !== rest);
  mark();
  return box;
}

export const button = (ic, label, onclick, extra = {}) => el('button', { type: 'button', class: 'gs-btn', onclick, ...extra }, [ic || null, label]);
