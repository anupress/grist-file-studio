// Where a file sits in the whole document: every Attachments cell, in every table, that holds it.
//
// A cell holds only file ids, and one id can be in many cells (a cell copied in Grist carries the id
// along), so "where is this file" is a question about the whole document, not the widget's table.
// Pure: the inputs are Grist's metadata rows and the tables' rows, as fetchTable returns them.

import { attachmentIds } from './values.js';

const hidden = (t) => !t || t.summarySourceTable || /^_grist|^GristHidden/.test(t.tableId);

/** Every Attachments column of every person-made table: [{tableId, tableRef, colId, colRef, label, isFormula}]. */
export function attachmentColumns(metaTables, metaColumns) {
  const byRef = new Map(metaTables.map((t) => [t.id, t]));
  return metaColumns
    .filter((c) => c.type === 'Attachments' && !hidden(byRef.get(c.parentId)))
    .map((c) => ({ tableId: byRef.get(c.parentId).tableId, tableRef: c.parentId, colId: c.colId, colRef: c.id, label: c.label || c.colId, isFormula: !!(c.isFormula && c.formula) }));
}

/**
 * file id -> the places it is in: [{tableId, colId, colRef, rowId, index}], in table, row and cell order.
 * @param tables [{tableId, rows: [{id, ...cells}]}]
 */
export function buildIndex(columns, tables) {
  const index = new Map();
  for (const { tableId, rows } of tables) {
    const cols = columns.filter((c) => c.tableId === tableId);
    for (const row of rows || []) {
      for (const c of cols) {
        attachmentIds(row[c.colId]).forEach((attId, i) => {
          if (!index.has(attId)) index.set(attId, []);
          index.get(attId).push({ tableId, colId: c.colId, colRef: c.colRef, rowId: row.id, index: i, isFormula: c.isFormula });
        });
      }
    }
  }
  return index;
}

/**
 * The Grist page and widget that best show a table: a table widget ('record') on a page first, else
 * any widget of that table on a page, else the table's raw data. Returns {viewRef, sectionRef} or
 * {raw: true, sectionRef} when only raw data shows it.
 */
export function placeFor(tableRef, { sections, pages, rawSectionRef = 0 }) {
  const onPages = new Set(pages.map((p) => p.viewRef));
  const order = new Map(pages.map((p) => [p.viewRef, p.pagePos ?? 0]));
  const mine = sections.filter((s) => s.tableRef === tableRef && onPages.has(s.parentId))
    .sort((a, b) => (a.parentKey === 'record' ? 0 : 1) - (b.parentKey === 'record' ? 0 : 1) || (order.get(a.parentId) - order.get(b.parentId)));
  if (mine.length) return { viewRef: mine[0].parentId, sectionRef: mine[0].id };
  return { raw: true, sectionRef: rawSectionRef };
}

/**
 * A link that opens a cell in Grist: the document's page with the cursor on the row and column.
 * docUrl is the document's address (the API's base URL with /api/docs/ turned into /doc/).
 */
export function cellLink(docUrl, place, { rowId, colRef }) {
  if (!docUrl || !place) return null;
  const page = place.raw ? 'data' : String(place.viewRef);
  const anchor = place.sectionRef ? `#a1.s${place.sectionRef}.r${rowId}.c${colRef}` : '';
  return `${docUrl.replace(/\/$/, '')}/p/${page}${anchor}`;
}

/** The API base URL Grist hands out with a token -> the document's own address. */
export function docUrlFromBase(baseUrl) {
  if (!baseUrl) return null;
  const m = /^(.*)\/api\/docs\/([^/?#]+)/.exec(baseUrl);
  return m ? `${m[1]}/doc/${m[2]}` : null;
}
