// How a mark looks on the page in the editor. It draws from the same description pdfops.js writes into the
// file (anchor, angle, sizes in points, the three standard fonts' metric twins), so the page on screen and the
// saved page agree.

import { el } from '../core/util.js';
import { smoothPathD, TICK_STROKES, LINE_HEIGHT } from '../media/pdfops.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

// Arial, Times New Roman and Courier New are the metric twins of Helvetica, Times and Courier.
export const FONT_CSS = {
  sans: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

/**
 * One mark as a DOM node, positioned on a sheet.
 * v = {w, h}: the sheet in CSS px; {Wd, Hd}: the page in points; k: CSS px per point.
 */
export function renderMark(m, v, { locked = false } = {}) {
  const px = m.x * v.w, py = m.y * v.h;
  let node;
  if (m.type === 'text') {
    const ax = m.align === 'center' ? 50 : m.align === 'right' ? 100 : 0;
    const ay = m.valign === 'middle' ? 50 : m.valign === 'bottom' ? 100 : 0;
    node = el('div', { class: 'gs-pe__mark gs-pe__text', text: m.text });
    Object.assign(node.style, {
      left: px + 'px', top: py + 'px', transformOrigin: '0 0', transform: `rotate(${m.angle || 0}deg) translate(-${ax}%, -${ay}%)`,
      fontSize: m.size * v.k + 'px', lineHeight: String(LINE_HEIGHT), fontFamily: FONT_CSS[m.font] || FONT_CSS.sans, fontWeight: m.bold ? '700' : '400',
      fontStyle: m.italic ? 'italic' : 'normal', color: m.color, textAlign: m.align || 'left', opacity: String(m.opacity ?? 1),
    });
  } else if (m.type === 'draw') {
    node = el('div', { class: 'gs-pe__mark gs-pe__draw' });
    const s = svg('svg', { width: v.w, height: v.h, viewBox: `0 0 ${v.w} ${v.h}` });
    const path = svg('path', { d: smoothPathD(m.points.map(([x, y]) => [x * v.w, y * v.h])), fill: 'none', stroke: m.color, 'stroke-width': Math.max(1, (m.width || 2) * v.k),
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': m.opacity ?? 1 });
    s.append(path);
    node.append(s);
    Object.assign(node.style, { left: '0', top: '0', width: v.w + 'px', height: v.h + 'px' });
  } else {
    const wpx = m.w * v.k, hpx = m.h * v.k;
    node = el('div', { class: `gs-pe__mark gs-pe__${m.type}` });
    Object.assign(node.style, { left: px - wpx / 2 + 'px', top: py - hpx / 2 + 'px', width: wpx + 'px', height: hpx + 'px', transform: `rotate(${m.angle || 0}deg)`, transformOrigin: 'center' });
    if (m.type === 'rect' || m.type === 'hilite') node.style.background = m.color;
    else if (m.type === 'image') node.append(el('img', { src: m.dataUrl, alt: '', draggable: false }));
    else if (m.type === 'check' || m.type === 'cross') {
      const s = svg('svg', { viewBox: '0 0 21 21', preserveAspectRatio: 'none', width: '100%', height: '100%' });
      for (const [x1, y1, x2, y2] of TICK_STROKES[m.type]) {
        s.append(svg('line', { x1, y1, x2, y2, stroke: m.color, 'stroke-width': 2.6 * ((m.weight || 2) / 2), 'stroke-linecap': 'round' }));
      }
      node.append(s);
    }
  }
  node.dataset.mark = m.id;
  if (locked) node.classList.add('is-locked');
  return node;
}

/** Marks whose box can be dragged larger or smaller. */
export const RESIZABLE = new Set(['rect', 'hilite', 'image', 'check', 'cross']);
/** Marks that keep their shape when resized. */
export const KEEPS_SHAPE = new Set(['image', 'check', 'cross']);
