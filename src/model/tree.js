// Folders inside folders. A folder is a record; a record's parent is the record a Reference column of the same table points to. This builds the
// tree from the records, whatever state the column is in (a missing parent, a record that is its own parent, a loop), and answers the questions
// the folder list and the moves ask. Pure: tested in tests/tree.test.mjs.

const collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;
const byTitle = (a, b) => (collator ? collator.compare(a.title, b.title) : a.title.localeCompare(b.title)) || a.rowId - b.rowId;

/** The record id a Reference cell points to (0 for none): Grist sends ['R', table, id] with keepEncoded, a plain number elsewhere. */
export function refId(v) {
  if (Array.isArray(v)) return v[0] === 'R' ? Number(v[2]) || 0 : 0;
  return typeof v === 'number' && v > 0 ? v : 0;
}

/**
 * @param records [{rowId, title, files: [...]}] (title may be empty)
 * @param parentOf (rowId) -> the parent's record id, or 0
 * @returns {{roots: Node[], nodes: Map<number, Node>}} Node = {rowId, title, own: files in the record, total: files in it and below, parent: Node|null, children: Node[], depth}
 *   A parent that is not among the records, the record itself, or a loop makes the record a top-level one: nothing is lost.
 */
export function buildTree(records, parentOf) {
  const nodes = new Map();
  for (const r of records) nodes.set(r.rowId, { rowId: r.rowId, title: String(r.title || ''), own: (r.files || []).length, total: 0, parent: null, children: [], depth: 0 });
  const roots = [];
  for (const r of records) {
    const n = nodes.get(r.rowId);
    const p = nodes.get(parentOf(r.rowId));
    if (p && p !== n) { n.parent = p; p.children.push(n); } else roots.push(n);
  }
  // a loop (A under B under A) is reachable from no top-level record: cut it at its first member
  const seen = new Set();
  const walk = (n) => { seen.add(n.rowId); n.children.forEach(walk); };
  roots.forEach(walk);
  for (const r of records) {
    if (seen.has(r.rowId)) continue;
    const n = nodes.get(r.rowId);
    n.parent.children = n.parent.children.filter((c) => c !== n);
    n.parent = null;
    roots.push(n);
    walk(n);
  }
  const finish = (n, depth) => {
    n.depth = depth;
    n.children.sort(byTitle);
    n.total = n.own;
    for (const c of n.children) { finish(c, depth + 1); n.total += c.total; }
  };
  roots.sort(byTitle);
  roots.forEach((n) => finish(n, 0));
  return { roots, nodes };
}

/** The record and everything below it, as a Set of record ids. */
export function subtreeIds(tree, rowId) {
  const out = new Set();
  const n = tree.nodes.get(rowId);
  if (!n) return out;
  const walk = (x) => { out.add(x.rowId); x.children.forEach(walk); };
  walk(n);
  return out;
}

/** The record ids from the top-level record down to this one's parent (empty for a top-level record). */
export function ancestorIds(tree, rowId) {
  const out = [];
  for (let n = tree.nodes.get(rowId)?.parent; n; n = n.parent) out.unshift(n.rowId);
  return out;
}

/** May this record be moved under that parent (0: to the top)? Not under itself or one of its own subfolders. */
export function canMoveTo(tree, rowId, parentId) {
  if (!tree.nodes.has(rowId)) return false;
  if (!parentId) return true;
  if (!tree.nodes.has(parentId)) return false;
  return !subtreeIds(tree, rowId).has(parentId);
}

/**
 * The rows the folder list shows, top to bottom: every top-level folder, and below an open one its subfolders. `open` is a Set of record ids.
 * A search (`only`, a Set of record ids to keep, with their ancestors) shows the matching folders and the way to them, all open.
 * @returns [{node, depth, open, hasChildren}]
 */
export function visibleRows(tree, open, only = null) {
  const keep = only ? new Set([...only].flatMap((id) => [id, ...ancestorIds(tree, id)])) : null;
  const out = [];
  const walk = (n) => {
    if (keep && !keep.has(n.rowId)) return;
    const kids = keep ? n.children.filter((c) => keep.has(c.rowId)) : n.children;
    const isOpen = keep ? kids.length > 0 : open.has(n.rowId);
    out.push({ node: n, depth: n.depth, open: isOpen && kids.length > 0, hasChildren: n.children.length > 0 });
    if (isOpen) kids.forEach(walk);
  };
  tree.roots.forEach(walk);
  return out;
}

/** The actions that put a folder under a parent (or at the top, with 0). `col` is the Reference column. */
export function moveFolderActions(table, rowId, col, parentId) {
  return [['UpdateRecord', table, rowId, { [col]: parentId || 0 }]];
}

/**
 * What lies below a folder that has no file of its own, for its card: the first file found in the folders under it (the cover), how many files and how many folders.
 * Null when the folder has nothing below it, or files of its own (its own cover is then used).
 * @param node a tree node (buildTree); @param coverOf (rowId) -> a file to show for that folder, or null
 */
export function belowOf(node, coverOf) {
  if (!node || node.own > 0 || !node.children.length || node.total <= node.own) return null;
  let cover = null, folders = 0;
  const walk = (n) => {
    for (const c of n.children) {
      folders++;
      if (!cover) cover = coverOf(c.rowId) || null;
      walk(c);
    }
  };
  walk(node);
  return { files: node.total - node.own, folders, cover };
}

/**
 * The folders directly below a folder, for the Viewer when that folder has no file of its own: each with its own file count, what lies below it
 * (belowOf) and a file to show as its cover. Empty when there is no folder below it.
 * @param node a tree node (buildTree); @param coverOf (rowId) -> a file to show for that folder, or null
 */
export function foldersBelow(node, coverOf) {
  if (!node) return [];
  return node.children.map((c) => {
    const below = belowOf(c, coverOf);
    return { rowId: c.rowId, title: c.title, own: c.own, below, cover: c.own > 0 ? coverOf(c.rowId) || null : below?.cover || null };
  });
}
