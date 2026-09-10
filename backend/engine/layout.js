// Stable city layout via a squarified treemap.
//
// The plot for each file is computed ONCE from the union of every file that
// ever existed (weighted by its peak size). Because plots never move, a file's
// building simply rises and falls in place as you scrub the timeline, instead
// of teleporting around when the file set changes commit-to-commit.

/** Build a nested directory tree from the flat file list. */
function buildTree(files) {
  const root = { name: '', path: '', children: new Map(), file: null, weight: 0 };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        // Weight by sqrt(peak LOC) so one huge file doesn't dwarf a whole
        // district. buildCity may supply a layoutWeight that also discounts
        // short-lived files, so demolished ones leave small lots rather than
        // hollowing out the finished city.
        node.children.set(part, {
          name: part, path: f.path, children: null, file: f,
          weight: f.layoutWeight ?? Math.sqrt(f.maxLoc) + 1,
        });
      } else {
        if (!node.children.has(part)) {
          node.children.set(part, {
            name: part, path: parts.slice(0, i + 1).join('/'),
            children: new Map(), file: null, weight: 0,
          });
        }
        node = node.children.get(part);
      }
    }
  }
  computeWeights(root);
  return root;
}

function computeWeights(node) {
  if (!node.children) return node.weight; // leaf
  let sum = 0;
  for (const child of node.children.values()) sum += computeWeights(child);
  node.weight = sum;
  return sum;
}

/**
 * Squarified treemap of a set of weights inside `rect` -> one rect per weight.
 * Standard Bruls/Huizing/van Wijk algorithm.
 */
function squarifyRects(weights, rect) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const area = rect.w * rect.d;
  const items = weights.map((w, i) => ({ a: (w / total) * area, i }));
  const result = new Array(weights.length);
  const free = { x: rect.x, z: rect.z, w: rect.w, d: rect.d };

  const shorter = () => Math.min(free.w, free.d);

  const worst = (row, side) => {
    if (row.length === 0) return Infinity;
    let sum = 0, max = -Infinity, min = Infinity;
    for (const n of row) { sum += n.a; if (n.a > max) max = n.a; if (n.a < min) min = n.a; }
    const s2 = side * side, sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  };

  const commit = (row) => {
    const side = shorter();
    const sum = row.reduce((s, n) => s + n.a, 0);
    const thickness = sum / side;
    if (free.w >= free.d) {
      // Fill a column of width=thickness, stacking items along z.
      let off = free.z;
      for (const n of row) {
        const len = n.a / thickness;
        result[n.i] = { x: free.x, z: off, w: thickness, d: len };
        off += len;
      }
      free.x += thickness; free.w -= thickness;
    } else {
      // Fill a row of height=thickness, items along x.
      let off = free.x;
      for (const n of row) {
        const len = n.a / thickness;
        result[n.i] = { x: off, z: free.z, w: len, d: thickness };
        off += len;
      }
      free.z += thickness; free.d -= thickness;
    }
  };

  let row = [];
  let i = 0;
  while (i < items.length) {
    const side = shorter();
    if (row.length === 0 || worst([...row, items[i]], side) <= worst(row, side)) {
      row.push(items[i]);
      i++;
    } else {
      commit(row);
      row = [];
    }
  }
  if (row.length) commit(row);
  return result;
}

// Gap left around a district, as a fraction of its shorter side. Shallow
// folders get wide gaps (main avenues), deeper ones get narrow gaps (side
// streets) — that hierarchy is what makes the result read as a street grid.
const DISTRICT_PAD = [0, 0.05, 0.055, 0.045];

function squarify(node, rect, out, depth) {
  if (!node.children) {
    // Leaf = a file. A generous inset leaves real street width around each
    // building — without it the blocks fuse into one mass and the coloured
    // district ground underneath is never visible.
    const inset = Math.min(rect.w, rect.d) * 0.34;
    out.plots[node.path] = {
      x: +(rect.x + rect.w / 2).toFixed(3),
      z: +(rect.z + rect.d / 2).toFixed(3),
      w: +Math.max(rect.w - inset, rect.w * 0.35).toFixed(3),
      d: +Math.max(rect.d - inset, rect.d * 0.35).toFixed(3),
    };
    return;
  }

  // District padding so folders read as separate blocks with roads between.
  let r = rect;
  if (depth > 0) {
    const pad = Math.min(rect.w, rect.d) * (DISTRICT_PAD[depth] ?? 0.03);
    r = { x: rect.x + pad, z: rect.z + pad, w: rect.w - 2 * pad, d: rect.d - 2 * pad };

    // Record the zone so the frontend can paint coloured ground under it.
    out.districts.push({
      path: node.path,
      name: node.name,
      depth,
      x: +(r.x + r.w / 2).toFixed(3),
      z: +(r.z + r.d / 2).toFixed(3),
      w: +r.w.toFixed(3),
      d: +r.d.toFixed(3),
    });
  }

  const children = [...node.children.values()]
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const rects = squarifyRects(children.map((c) => c.weight), r);
  children.forEach((child, idx) => squarify(child, rects[idx], out, depth + 1));
}

/**
 * files -> { plots, districts } centered around the origin.
 *   plots:     { "path": { x, z, w, d } }  one per file
 *   districts: [{ path, name, depth, x, z, w, d }]  folder zones, for ground
 */
export function layoutTreemap(files, size = 100) {
  const root = buildTree(files);
  const out = { plots: {}, districts: [] };
  squarify(root, { x: -size / 2, z: -size / 2, w: size, d: size }, out, 0);
  return out;
}
