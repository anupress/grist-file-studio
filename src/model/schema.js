// Grist's metadata, turned into the column list that role detection and the views work from.
//
// Pure on purpose: the input is the rows of _grist_Tables and _grist_Tables_column exactly as
// fetchTable returns them, so every rule here can be tested in Node against real template schemas.

/** Columns no person made and no role can use. */
const isPlumbing = (colId) => colId === 'manualSort' || colId === 'id' || /^gristHelper_/.test(colId);

function parseOptions(raw) {
  if (!raw) return {};
  try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

/** 'Ref:People' -> 'People', 'RefList:Tasks' -> 'Tasks', anything else -> null. */
export function refTableOf(type) {
  const m = /^Ref(?:List)?:(.+)$/.exec(String(type || ''));
  return m ? m[1] : null;
}

/** The base kind of a Grist type: 'Date', 'DateTime', 'Ref', 'RefList', 'Text', 'Choice', ... */
export function kindOf(type) {
  const t = String(type || 'Any');
  if (/^DateTime/.test(t)) return 'DateTime';
  if (/^RefList:/.test(t)) return 'RefList';
  if (/^Ref:/.test(t)) return 'Ref';
  return t;
}

/**
 * The person-made columns of one table, in the order Grist shows them.
 *
 * @returns {Array<{ref:number, id:string, label:string, type:string, kind:string, isFormula:boolean,
 *   refTable:string|null, visibleColId:string|null, choices:string[], choiceOptions:object}>}
 */
export function tableColumns(tableId, metaTables, metaColumns) {
  const table = metaTables.find((t) => t.tableId === tableId);
  if (!table) return [];
  const byRef = new Map(metaColumns.map((c) => [c.id, c]));
  return metaColumns
    .filter((c) => c.parentId === table.id && !isPlumbing(c.colId))
    .sort((a, b) => (a.parentPos ?? 0) - (b.parentPos ?? 0))
    .map((c) => {
      const opts = parseOptions(c.widgetOptions);
      return {
        ref: c.id,
        id: c.colId,
        label: c.label || c.colId,
        type: c.type || 'Any',
        kind: kindOf(c.type),
        // A formula column with no formula is Grist's "empty column": the first write makes it data.
        isFormula: !!(c.isFormula && c.formula),
        refTable: refTableOf(c.type),
        visibleColId: c.visibleCol ? (byRef.get(c.visibleCol)?.colId || null) : null,
        choices: Array.isArray(opts.choices) ? opts.choices : [],
        choiceOptions: opts.choiceOptions && typeof opts.choiceOptions === 'object' ? opts.choiceOptions : {},
      };
    });
}

/**
 * The same shape built from a fixture ({id, type, isFormula?, choices?, label?}), so the detection
 * tests read like the templates they come from.
 */
export function columnsFromFixture(cols) {
  return cols.map((c, i) => ({
    ref: i + 1, id: c.id, label: c.label || c.id, type: c.type, kind: kindOf(c.type), isFormula: !!c.isFormula,
    refTable: refTableOf(c.type), visibleColId: null, choices: c.choices || [], choiceOptions: {},
  }));
}

