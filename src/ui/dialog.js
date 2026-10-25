// Dialogs over the widget: a yes/no question, a line of text to type, and the focus handling every
// dialog, drawer and the lightbox share.

import { el } from '../core/util.js';
import { t } from '../i18n/index.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep the keyboard inside a dialog while it is open: Tab and Shift+Tab cycle through its controls,
 * Escape closes it, and when it closes the focus goes back to where it was, so a keyboard or
 * screen-reader user never lands on the page behind.
 * @returns {Function} release: call it when the dialog closes
 */
// Traps stack: an editor opened over the lightbox, a menu over the editor. Only the topmost one
// handles keys, or Escape in the editor would close the lightbox underneath it.
const traps = [];

export function trapFocus(container, onEscape) {
  const before = document.activeElement;
  const me = {};
  traps.push(me);
  const onKey = (e) => {
    if (traps[traps.length - 1] !== me) return;
    // Without an onEscape the container handles Escape itself (an editor whose search panel or cell
    // input uses it first).
    if (e.key === 'Escape') { if (!onEscape) return; e.preventDefault(); e.stopPropagation(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!container.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  return () => {
    const at = traps.indexOf(me);
    if (at >= 0) traps.splice(at, 1);
    document.removeEventListener('keydown', onKey, true);
    if (before && typeof before.focus === 'function' && document.contains(before)) before.focus({ preventScroll: true });
  };
}

/**
 * A question with two answers. Resolves true or false. `danger` paints the main button red; `items`
 * lists what the answer touches (the cells a file leaves), under the text.
 */
export function confirmBox(host, { title, body, items = null, ok, cancel = t('Cancel'), danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(false) });
    const okBtn = el('button', { type: 'button', class: 'gs-btn gs-btn--primary' + (danger ? ' gs-btn--danger' : ''), text: ok, onclick: () => done(true) });
    const box = el('div', { class: 'gs-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-dlg-t', 'aria-describedby': 'gs-dlg-b' }, [
      el('h2', { id: 'gs-dlg-t', text: title }),
      el('p', { id: 'gs-dlg-b', text: body }),
      items?.length ? el('ul', { class: 'gs-dialog__list' }, items.map((x) => el('li', { text: x }))) : null,
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: cancel, onclick: () => done(false) }), okBtn]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(false));
    okBtn.focus();
  });
}

/**
 * A question with several answers, the first one the main one. Resolves the chosen value, or null
 * when cancelled. choices: [[label, value, hint?]]
 */
export function choiceBox(host, { title, body, choices, cancel = t('Cancel') }) {
  return new Promise((resolve) => {
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const buttons = choices.map(([label, value, hint], i) => el('button', {
      type: 'button', class: 'gs-btn gs-choice' + (i ? '' : ' gs-btn--primary'), onclick: () => done(value),
    }, [el('span', { class: 'gs-choice__label', text: label }), hint ? el('span', { class: 'gs-choice__hint', text: hint }) : null]));
    const box = el('div', { class: 'gs-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-dlg-t' }, [
      el('h2', { id: 'gs-dlg-t', text: title }),
      body ? el('p', { text: body }) : null,
      el('div', { class: 'gs-choices' }, buttons),
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: cancel, onclick: () => done(null) })]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    buttons[0]?.focus();
  });
}

/**
 * A line of text to type (a new file name). Resolves the text, or null when cancelled.
 * @param o {select: [start, end] of the text to select at first, e.g. the name without its extension}
 */
export function textBox(host, { title, body = '', label, value = '', ok = t('Save'), cancel = t('Cancel'), select = null, check = null, secret = false, empty = null }) {
  return new Promise((resolve) => {
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const problem = el('p', { class: 'gs-dialog__problem', role: 'alert', hidden: true });
    const submit = () => {
      const v = secret ? input.value : input.value.trim();   // a password is taken as typed
      const why = !v ? (empty || (secret ? t('Type the password.') : t('Type a name.'))) : check ? check(v) : null;
      if (why) { problem.textContent = why; problem.hidden = false; input.focus(); return; }
      done(v);
    };
    const input = el('input', { type: secret ? 'password' : 'text', id: 'gs-dlg-x', class: 'gs-input', value, spellcheck: false, autocomplete: secret ? 'off' : null,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } });
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('form', { class: 'gs-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-dlg-t',
      onsubmit: (e) => { e.preventDefault(); submit(); } }, [
      el('h2', { id: 'gs-dlg-t', text: title }),
      body ? el('p', { text: body }) : null,
      el('div', { class: 'gs-field' }, [el('label', { for: 'gs-dlg-x', text: label }), input]),
      problem,
      el('div', { class: 'gs-dialog__foot' }, [
        el('button', { type: 'button', class: 'gs-btn', text: cancel, onclick: () => done(null) }),
        el('button', { type: 'submit', class: 'gs-btn gs-btn--primary', text: ok }),
      ]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    input.focus();
    if (select) input.setSelectionRange(select[0], select[1]); else input.select();
  });
}

/**
 * A small panel of controls under a button (the Display options). `build(close)` returns its content.
 * Closes on a click outside or Escape; the focus goes back to the button.
 */
export function openPopover(host, anchor, build, { label = '' } = {}) {
  const close = () => { release(); document.removeEventListener('pointerdown', outside, true); pop.remove(); anchor.setAttribute('aria-expanded', 'false'); };
  const outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
  const pop = el('div', { class: 'gs-pop', role: 'dialog', 'aria-label': label }, [build(close)]);
  host.append(pop);
  const hb = host.getBoundingClientRect();
  const ab = anchor.getBoundingClientRect();
  const left = Math.max(6, Math.min(ab.right - hb.left - pop.offsetWidth, hb.width - pop.offsetWidth - 6));
  pop.style.left = left + 'px';
  pop.style.top = ab.bottom - hb.top + 4 + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', outside, true);
  const release = trapFocus(pop, close);
  pop.querySelector('input, button, select')?.focus();
  return close;
}

/**
 * A small menu under a button: [label, run, {danger, disabled, hint, note}] items, or null for a
 * separator. `hint` is the tooltip; `note` a short second line always shown under the label, for the
 * items whose effect is not obvious from their name. Closes on a pick, a click outside or Escape.
 * The anchor is the button the menu opens under, or a point {x, y} (a right click): then the menu's corner is at the point.
 */
export function openMenu(host, anchor, items, { align = 'right' } = {}) {
  const point = typeof anchor.getBoundingClientRect !== 'function';
  const close = () => { release(); document.removeEventListener('pointerdown', outside, true); menu.remove(); };
  const outside = (e) => { if (!menu.contains(e.target) && (point || (e.target !== anchor && !anchor.contains(e.target)))) close(); };
  const menu = el('div', { class: 'gs-menu', role: 'menu' }, items.map((it) => (it ? el('button', {
    type: 'button', role: 'menuitem', class: 'gs-menu__item' + (it[2]?.danger ? ' is-danger' : '') + (it[2]?.note ? ' has-note' : ''), disabled: !!it[2]?.disabled,
    title: it[2]?.hint || null, onclick: () => { close(); it[1](); },
  }, it[2]?.note ? [el('span', { class: 'gs-menu__label', text: it[0] }), el('span', { class: 'gs-menu__note', text: it[2].note })] : [it[0]])
    : el('div', { class: 'gs-menu__sep', role: 'separator' }))));
  host.append(menu);
  const hb = host.getBoundingClientRect();
  const ab = point ? { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y } : anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === 'right' && !point ? ab.right - hb.left - mw : ab.left - hb.left;
  left = Math.max(6, Math.min(left, hb.width - mw - 6));
  let top = ab.bottom - hb.top + (point ? 0 : 4);
  if (top + mh > hb.height - 6) top = Math.max(6, ab.top - hb.top - mh - (point ? 0 : 4));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  document.addEventListener('pointerdown', outside, true);
  const release = trapFocus(menu, close);
  menu.querySelector('button:not([disabled])')?.focus();
  return close;
}
