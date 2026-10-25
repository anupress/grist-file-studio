// The photo report as a PDF: the layout from model/report.js, drawn with pdf-lib's standard fonts.
//
// `lib` is the pdf-lib namespace (the browser passes the vendored bundle, the tests pass the same file from Node).
// Pictures arrive already made small and as JPEGs (media/reportimages.js), so the file stays a size that can be mailed.

import { layoutReport } from '../model/report.js';
import { hexToRgb, BASELINE } from './pdfops.js';

const INK = '#111827', MUTED = '#5b6b7e', LINE = '#d5dde6';

/**
 * @param spec as for layoutReport, without footer text (it is made here: footer(page, pages))
 * @param images [{bytes: Uint8Array, type: 'jpg' | 'png'}] one per spec.photos entry, in order
 * @param meta {title, author, subject}
 * @returns {Promise<{bytes: Uint8Array, pages: number, dropped: string[]}>}  dropped: characters the standard font cannot draw
 */
export async function buildReport(lib, spec, images, meta = {}) {
  const doc = await lib.PDFDocument.create();
  const regular = await doc.embedFont(lib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(lib.StandardFonts.HelveticaBold);
  const charset = new Set(regular.getCharacterSet());
  const dropped = new Set();
  // Whatever the standard font has no letter for is drawn as "?" and reported, as in the PDF editor.
  const clean = (s) => [...String(s ?? '').replace(/[\u0000-\u001f]/g, ' ')].map((ch) => {
    if (charset.has(ch.codePointAt(0))) return ch;
    dropped.add(ch);
    return '?';
  }).join('');
  const measure = (s, size, b) => (b ? bold : regular).widthOfTextAtSize(clean(s), size);

  const layout = layoutReport({ ...spec, footer: spec.footer }, measure);
  const embedded = new Map();
  const embed = async (i) => {
    if (!embedded.has(i)) embedded.set(i, images[i].type === 'png' ? await doc.embedPng(images[i].bytes) : await doc.embedJpg(images[i].bytes));
    return embedded.get(i);
  };
  const ink = hexToRgb(lib, INK), muted = hexToRgb(lib, MUTED), line = hexToRgb(lib, LINE);
  const { w: W, h: H } = layout.size;

  for (const p of layout.pages) {
    const page = doc.addPage([W, H]);
    for (const op of p.ops) {
      if (op.k === 'rule') {
        page.drawLine({ start: { x: op.x1, y: H - op.y }, end: { x: op.x2, y: H - op.y }, thickness: 0.75, color: line });
      } else if (op.k === 'photo') {
        page.drawImage(await embed(op.i), { x: op.x, y: H - op.y - op.h, width: op.w, height: op.h });
        page.drawRectangle({ x: op.x, y: H - op.y - op.h, width: op.w, height: op.h, borderColor: line, borderWidth: 0.5 });
      } else {
        const font = op.bold ? bold : regular;
        const text = clean(op.text);
        const w = font.widthOfTextAtSize(text, op.size);
        const x = op.align === 'center' ? op.x - w / 2 : op.align === 'right' ? op.x - w : op.x;
        page.drawText(text, { x, y: H - op.y - op.size * BASELINE.sans, size: op.size, font, color: op.muted ? muted : ink });
      }
    }
  }
  if (meta.title) doc.setTitle(clean(meta.title));
  if (meta.author) doc.setAuthor(clean(meta.author));
  if (meta.subject) doc.setSubject(clean(meta.subject));
  doc.setProducer('ANUPRESS File Studio');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());
  return { bytes: await doc.save({ useObjectStreams: true }), pages: layout.pages.length, dropped: [...dropped] };
}
