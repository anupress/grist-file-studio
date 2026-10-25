// The upload tray: one line per file with its progress, in the corner, until everything is done.
// It closes by itself a few seconds after the last file arrived, unless something failed: then it
// stays, with the reason, until it is closed.

import { el, clear } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { sizeText } from '../model/kinds.js';
import { t, tn, uiLang } from '../i18n/index.js';

export function createTray(host) {
  let box = null, list = null, head = null, rows = [], timer = 0;

  function ensure() {
    if (box) return;
    head = el('span');
    list = el('div', { class: 'gs-tray__list' });
    box = el('div', { class: 'gs-tray', role: 'status', 'aria-live': 'polite' }, [
      el('div', { class: 'gs-tray__head' }, [head, el('button', { type: 'button', class: 'gs-icon-btn', 'aria-label': t('Close'), onclick: () => close() }, [icon('close')])]),
      list,
    ]);
    host.append(box);
  }
  function close() { clearTimeout(timer); box?.remove(); box = null; rows = []; }
  function summary() {
    const busy = rows.filter((r) => r.state === 'busy').length;
    const failed = rows.filter((r) => r.state === 'error').length;
    head.textContent = busy ? tn(busy, 'Uploading {n} file', 'Uploading {n} files')
      : failed ? tn(failed, '{n} file not added', '{n} files not added') : tn(rows.length, '{n} file added', '{n} files added');
    clearTimeout(timer);
    if (!busy && !failed) timer = setTimeout(close, 3500);
  }

  return {
    /** Start lines for these files. Returns a handle per file: progress(fraction), done(), fail(reason). */
    start(files) {
      ensure();
      clearTimeout(timer);
      const handles = files.map((f) => {
        const fill = el('div', { class: 'gs-tray__fill' });
        const state = el('span', { class: 'gs-tray__state', text: sizeText(f.size, uiLang()) });
        const row = el('div', { class: 'gs-tray__row' }, [el('span', { class: 'gs-tray__name', text: f.name, title: f.name }), state, el('div', { class: 'gs-tray__bar' }, [fill])]);
        list.append(row);
        const r = { state: 'busy' };
        rows.push(r);
        return {
          progress(p) { fill.style.width = Math.round(Math.min(1, p) * 100) + '%'; state.textContent = Math.round(Math.min(1, p) * 100) + ' %'; },
          done() { r.state = 'done'; fill.style.width = '100%'; row.classList.add('is-done'); state.textContent = t('Added'); summary(); },
          fail(why) {
            r.state = 'error'; row.classList.add('is-error'); state.textContent = t('Not added');
            if (why) row.append(el('div', { class: 'gs-tray__why', text: why }));
            summary();
          },
        };
      });
      summary();
      return handles;
    },
    close,
  };
}
