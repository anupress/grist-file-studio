// Two pictures on top of each other with a divider to drag: before and after, last year and this year, the damp patch then and now.
// Both are drawn in one box with the first picture's shape, so a pair taken from the same spot lines up; the first shows on the left of the divider, the second on
// the right. A dialog in the same dark room as the lightbox; the divider is a slider for the keyboard too.

import { el } from '../core/util.js';
import { icon } from '../core/assets/icons.js';
import { trapFocus } from '../ui/dialog.js';
import { stepDivider, dividerAt } from '../model/viewing.js';
import { t } from '../i18n/index.js';
import { heicJpeg } from '../media/picture.js';

const MAX_BYTES = 80e6;

/**
 * @param o {a, b: files (pictures), source, onClose()}
 * @returns {{close()}}
 */
export function openCompare(host, o) {
  let first = o.a, second = o.b, pos = 50, gone = false;
  const urls = [];
  const swapBtn = el('button', { type: 'button', class: 'gs-lb__btn', title: t('Swap the two pictures'), 'aria-label': t('Swap the two pictures'), onclick: () => { [first, second] = [second, first]; load(); } }, [icon('refresh2')]);
  const closeBtn = el('button', { type: 'button', class: 'gs-lb__btn', title: t('Close (Esc)'), 'aria-label': t('Close (Esc)'), onclick: () => close() }, [icon('close')]);
  const bar = el('div', { class: 'gs-lb__bar' }, [el('span', { class: 'gs-lb__name', text: t('Compare two pictures') }), el('div', { class: 'gs-lb__tools' }, [swapBtn, el('span', { class: 'gs-lb__sep' }), closeBtn])]);

  const imgA = el('img', { class: 'gs-cmp__img', alt: '' });
  const imgB = el('img', { class: 'gs-cmp__img', alt: '' });
  const tagA = el('span', { class: 'gs-cmp__tag is-a' });
  const tagB = el('span', { class: 'gs-cmp__tag is-b' });
  const grip = el('div', { class: 'gs-cmp__line', role: 'slider', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [el('span', { class: 'gs-cmp__grip', 'aria-hidden': 'true' })]);
  const wait = el('div', { class: 'gs-cmp__wait', role: 'status', text: t('Loading') });
  const frame = el('div', { class: 'gs-cmp__frame' }, [imgB, imgA, tagA, tagB, grip]);
  const stage = el('div', { class: 'gs-cmp__stage' }, [frame, wait]);
  const box = el('div', { class: 'gs-lightbox gs-cmp', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Compare two pictures'), tabindex: '-1' }, [bar, stage,
    el('p', { class: 'gs-cmp__hint', text: t('Drag the divider, or use the arrow keys when it is selected.') })]);
  host.append(box);
  const release = trapFocus(box, () => close());

  function place() {
    imgA.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    grip.style.left = pos + '%';
    grip.setAttribute('aria-valuenow', String(Math.round(pos)));
    grip.setAttribute('aria-valuetext', t('{pct} % of “{name}” shows', { pct: Math.round(pos), name: first.name }));
    grip.setAttribute('aria-label', t('Divider between “{a}” and “{b}”', { a: first.name, b: second.name }));
    tagA.style.opacity = pos > 14 ? '1' : '0';
    tagB.style.opacity = pos < 86 ? '1' : '0';
  }
  async function pictureUrl(file) {
    if (file.size > MAX_BYTES) throw new Error('too large');
    const blob = await o.source.blob(file);
    const url = URL.createObjectURL(file.kind === 'heic' ? await heicJpeg(blob, { maxSide: 4096 }) : blob);
    urls.push(url);
    return url;
  }
  async function load() {
    wait.hidden = false;
    wait.textContent = t('Loading');
    tagA.textContent = first.name; tagB.textContent = second.name;
    tagA.title = first.name; tagB.title = second.name;
    place();
    try {
      const [ua, ub] = await Promise.all([pictureUrl(first), pictureUrl(second)]);
      if (gone) return;
      imgA.src = ua; imgB.src = ub;
      await Promise.all([imgA, imgB].map((im) => im.decode().catch(() => {})));
      fit();
      wait.hidden = true;
    } catch {
      if (gone) return;
      wait.textContent = t('These pictures could not be loaded.');
    }
  }

  /** The frame takes the first picture's shape and as much of the stage as fits. */
  function fit() {
    const w = imgA.naturalWidth, h = imgA.naturalHeight, sw = stage.clientWidth, sh = stage.clientHeight;
    if (!(w > 0 && h > 0 && sw > 0 && sh > 0)) return;
    const k = Math.min(sw / w, sh / h);
    frame.style.width = Math.round(w * k) + 'px';
    frame.style.height = Math.round(h * k) + 'px';
  }
  const ro = new ResizeObserver(() => fit());
  ro.observe(stage);
  const move = (e) => { const r = frame.getBoundingClientRect(); pos = dividerAt(e.clientX, r.left, r.width); place(); };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    move(e);
    grip.focus({ preventScroll: true });
    const drag = (ev) => move(ev);
    const up = () => { stage.removeEventListener('pointermove', drag); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
    stage.addEventListener('pointermove', drag);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    const next = stepDivider(pos, e.key, e.shiftKey);
    if (next == null) return;
    e.preventDefault(); e.stopPropagation();
    pos = next; place();
  });

  function close() {
    if (gone) return;
    gone = true;
    ro.disconnect();
    release();
    for (const u of urls) URL.revokeObjectURL(u);
    box.remove();
    o.onClose?.();
  }
  load();
  grip.focus({ preventScroll: true });
  return { close };
}
