// A signature, drawn with the mouse, a finger or a pen: a transparent PNG cut to the ink, ready to place
// on a page. It may be kept in this browser for the next time (never anywhere else).

import { el } from '../core/util.js';
import { trapFocus } from './dialog.js';
import { smoothPathD } from '../media/pdfops.js';
import { t } from '../i18n/index.js';

const KEY = 'file-studio-signature';
const PAD_W = 460, PAD_H = 170;
const INKS = [['#111827', 'Black'], ['#1d4ed8', 'Blue']];
const INK_LABELS = { Black: 'Black', Blue: 'Blue' };

const saved = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.dataUrl ? v : null; } catch { return null; } };
const keep = (sig) => { try { sig ? localStorage.setItem(KEY, JSON.stringify(sig)) : localStorage.removeItem(KEY); } catch { /* private window: it is simply not kept */ } };

/** @returns Promise<{dataUrl, w, h} | null>   w and h in CSS pixels at the pad's scale */
export function openSignPad(host) {
  return new Promise((resolve) => {
    let ink = INKS[0][0], strokes = [], current = null;
    const done = (v) => { release(); scrim.remove(); box.remove(); resolve(v); };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = el('canvas', { class: 'gs-sign__pad', width: Math.round(PAD_W * dpr), height: Math.round(PAD_H * dpr), 'aria-label': t('Draw your signature here') });
    canvas.style.width = PAD_W + 'px';
    canvas.style.height = PAD_H + 'px';
    const ctx = canvas.getContext('2d');
    const hint = el('div', { class: 'gs-sign__hint', text: t('Sign here with the mouse, a finger or a pen.') });
    const use = el('button', { type: 'button', class: 'gs-btn gs-btn--primary', text: t('Use this signature'), disabled: true, onclick: () => finish() });
    const clearBtn = el('button', { type: 'button', class: 'gs-btn', text: t('Start again'), disabled: true, onclick: () => { strokes = []; paint(); } });
    const remember = el('input', { type: 'checkbox' });
    const old = saved();

    function paint() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of [...strokes, ...(current ? [current] : [])]) {
        ctx.strokeStyle = s.color; ctx.lineWidth = 2.6 * dpr;
        if (s.pts.length === 1) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.pts[0][0] * dpr, s.pts[0][1] * dpr, 1.4 * dpr, 0, 7); ctx.fill(); continue; }
        ctx.stroke(new Path2D(smoothPathD(s.pts.map(([x, y]) => [x * dpr, y * dpr]))));
      }
      const has = strokes.length > 0;
      use.disabled = !has; clearBtn.disabled = !has;
      hint.hidden = has || !!current;
    }
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (PAD_W / r.width), (e.clientY - r.top) * (PAD_H / r.height)]; };
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); current = { color: ink, pts: [at(e)] }; paint(); });
    canvas.addEventListener('pointermove', (e) => { if (current) { current.pts.push(at(e)); paint(); } });
    const end = () => { if (current) { strokes.push(current); current = null; paint(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function finish() {
      // Cut the canvas to the ink, with a little room.
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let x0 = width, y0 = height, x1 = 0, y1 = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const pad = Math.round(4 * dpr);
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      const sig = { dataUrl: out.toDataURL('image/png'), w: out.width / dpr, h: out.height / dpr };
      if (remember.checked) keep(sig);
      done(sig);
    }

    const swatches = el('div', { class: 'gs-ed__chips' }, INKS.map(([color, name]) => el('button', {
      type: 'button', class: 'gs-chip' + (color === ink ? ' is-on' : ''), text: t(INK_LABELS[name]), 'aria-pressed': color === ink ? 'true' : 'false',
      onclick: (e) => { ink = color; swatches.querySelectorAll('.gs-chip').forEach((b) => { b.classList.toggle('is-on', b === e.currentTarget); b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); }); },
    })));
    const scrim = el('div', { class: 'gs-scrim', onclick: () => done(null) });
    const box = el('div', { class: 'gs-dialog gs-dialog--wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gs-sign-t' }, [
      el('h2', { id: 'gs-sign-t', text: t('Your signature') }),
      el('div', { class: 'gs-sign__wrap' }, [canvas, hint]),
      el('div', { class: 'gs-ed__row' }, [el('span', { class: 'gs-label', text: t('Ink') }), swatches, el('span', { style: { flex: '1' } }), clearBtn]),
      el('label', { class: 'gs-check gs-sign__keep' }, [remember, t('Keep it in this browser for next time')]),
      old ? el('div', { class: 'gs-sign__old' }, [
        el('img', { src: old.dataUrl, alt: t('The signature kept in this browser'), style: { height: Math.min(40, old.h) + 'px' } }),
        el('button', { type: 'button', class: 'gs-btn', text: t('Use the kept one'), onclick: () => done(old) }),
        el('button', { type: 'button', class: 'gs-btn', text: t('Forget it'), onclick: (e) => { keep(null); e.currentTarget.parentElement.remove(); } }),
      ]) : null,
      el('div', { class: 'gs-dialog__foot' }, [el('button', { type: 'button', class: 'gs-btn', text: t('Cancel'), onclick: () => done(null) }), use]),
    ]);
    host.append(scrim, box);
    const release = trapFocus(box, () => done(null));
    paint();
    canvas.focus();
  });
}
