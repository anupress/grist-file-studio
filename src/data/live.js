// Reading the document around the rows: column metadata, file metadata, the labels of References,
// and this widget's own section. All of it through connect.js with full access.
//
// The rows arrive by push (onRecords). These tables do not: Grist sends nothing when another table
// or _grist_Attachments changes (M0), so the caller re-reads them when it needs to.

import { fetchRows } from '../grist/connect.js';
import { tableColumns } from '../model/schema.js';
import { cellText } from '../model/values.js';
import { metaFromRows } from '../model/files.js';
import { attachmentColumns, buildIndex, placeFor } from '../model/locations.js';

let metaCache = null;
export function forgetMeta() { metaCache = null; }

async function meta() {
  if (!metaCache) {
    const [tables, columns] = await Promise.all([fetchRows('_grist_Tables'), fetchRows('_grist_Tables_column')]);
    metaCache = { tables, columns };
  }
  return metaCache;
}

/** The table's columns, in Grist's order. */
export async function loadColumns(tableId) {
  const m = await meta();
  return tableColumns(tableId, m.tables, m.columns);
}

/** Every file's metadata: Map(id -> {id, name, ext, kind, size, ident, w, h, uploaded}). */
export async function loadFileMeta() {
  return metaFromRows(await fetchRows('_grist_Attachments'));
}

/**
 * For each Reference column the cards show: rowId -> the text Grist shows for it (the referenced
 * table's "show column"). One read per referenced table.
 */
export async function loadLabels(columns, colIds) {
  const m = await meta();
  const out = {};
  const tables = new Map();
  for (const id of colIds) {
    const c = columns.find((x) => x.id === id);
    if (!c || !c.refTable) continue;
    if (!tables.has(c.refTable)) tables.set(c.refTable, fetchRows(c.refTable).catch(() => []));
    const rows = await tables.get(c.refTable);
    const target = m.tables.find((t) => t.tableId === c.refTable);
    const shownMeta = target && c.visibleColId ? m.columns.find((x) => x.parentId === target.id && x.colId === c.visibleColId) : null;
    const shown = shownMeta ? tableColumns(c.refTable, m.tables, m.columns).find((x) => x.id === shownMeta.colId) : null;
    const map = new Map();
    for (const r of rows) map.set(r.id, shown ? cellText(r[shown.id], shown) || `${c.refTable}[${r.id}]` : `${c.refTable}[${r.id}]`);
    out[c.id] = map;
  }
  return out;
}

/**
 * This widget's own section in _grist_Views_section, when it can be told apart: a custom section on
 * this table whose URL is this page. With two File Studio widgets on one table, the one whose saved
 * options match these is it; failing that there is no answer (null).
 * @returns {Promise<{id, fieldCount, linkSrcSectionRef, linkTargetColId}|null>}
 */
export async function loadOwnSection(tableId, options = null) {
  try {
    const m = await meta();
    const tableRef = m.tables.find((t) => t.tableId === tableId)?.id;
    const [sections, fields] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Views_section_field')]);
    const here = location.origin + location.pathname;
    const parse = (s) => { try { return JSON.parse(JSON.parse(s.options || '{}').customView || '{}'); } catch { return {}; } };
    let mine = sections.filter((s) => s.parentKey === 'custom' && s.tableRef === tableRef)
      .map((s) => ({ s, cv: parse(s) }))
      .filter(({ cv }) => typeof cv.url === 'string' && cv.url.split('?')[0] === here);
    if (mine.length > 1 && options) {
      const want = JSON.stringify(options);
      mine = mine.filter(({ cv }) => { try { return JSON.stringify(typeof cv.widgetOptions === 'string' ? JSON.parse(cv.widgetOptions) : cv.widgetOptions) === want; } catch { return false; } });
    }
    if (mine.length !== 1) return null;
    const { s } = mine[0];
    const target = m.columns.find((c) => c.id === s.linkTargetColRef);
    return {
      id: s.id,
      fieldCount: fields.filter((f) => f.parentId === s.id).length,
      linkSrcSectionRef: s.linkSrcSectionRef || 0,
      linkTargetColId: target ? target.colId : null,
    };
  } catch { return null; }
}

/**
 * Every Attachments cell of the document, for "Where it is": the index (file id -> places), the
 * tables read for it (so a place's row can be shown without reading again), and where each table can
 * be opened in Grist. Read on demand: it reads every table that has an Attachments column.
 * @returns {Promise<{index: Map, tables: Map<tableId, {columns, rows: Map<rowId,row>}>, placeOf: (tableId) => place}>}
 */
export async function loadLocations() {
  const m = await meta();
  const columns = attachmentColumns(m.tables, m.columns);
  const tableIds = [...new Set(columns.map((c) => c.tableId))];
  const [sections, pages] = await Promise.all([fetchRows('_grist_Views_section'), fetchRows('_grist_Pages')]);
  const read = await Promise.all(tableIds.map((id) => fetchRows(id).then((rows) => ({ tableId: id, rows })).catch(() => ({ tableId: id, rows: [] }))));
  const index = buildIndex(columns, read);
  const tables = new Map(read.map(({ tableId, rows }) => [tableId, { columns: tableColumns(tableId, m.tables, m.columns), rows: new Map(rows.map((r) => [r.id, r])) }]));
  const placeOf = (tableId) => {
    const t = m.tables.find((x) => x.tableId === tableId);
    return t ? placeFor(t.id, { sections, pages, rawSectionRef: t.rawViewSectionRef || 0 }) : null;
  };
  return { index, tables, placeOf };
}
