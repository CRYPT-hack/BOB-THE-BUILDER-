import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Building archetypes.
//
// Every archetype is authored inside the SAME unit cube (x,z in [-0.5,0.5],
// y in [-0.5,0.5]) and is composed of axis-aligned boxes. That matters for two
// reasons: the instance matrix that positions a plain box still positions
// these unchanged, and one archetype = one InstancedMesh = one draw call. Seven
// shapes therefore cost seven draw calls no matter how many buildings exist.
//
// Each vertex also carries `aWidthFrac`: how wide the sub-box it belongs to is
// along that face's horizontal axis. The facade shader needs it, otherwise a
// narrow wing of an L-shaped block would cram a full building's worth of
// windows into half the width.

/** A box placed by its FOOTPRINT and its BASE height, in unit-cube space. */
function part(w, h, d, x = 0, z = 0, base = -0.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, base + h / 2, z);

  // uv.x runs along Z on the ±X faces, and along X everywhere else.
  const n = g.attributes.normal;
  const wf = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) {
    wf[i] = Math.abs(n.getX(i)) > 0.5 ? d : w;
  }
  g.setAttribute('aWidthFrac', new THREE.BufferAttribute(wf, 1));
  return g;
}

const merge = (parts) => mergeGeometries(parts, false);

/**
 * Slab — the plain extruded footprint. Still the workhorse; most files are
 * small and a small building should read as a simple shed.
 */
const slab = () => merge([part(1, 1, 1)]);

/** Setback tower: three diminishing stages, the classic high-rise profile. */
const setback = () => merge([
  part(1.0, 0.55, 1.0),
  part(0.72, 0.30, 0.72, 0, 0, 0.05),
  part(0.46, 0.15, 0.46, 0, 0, 0.35),
]);

/** L-shaped block wrapping a corner. */
const lshape = () => merge([
  part(1.0, 1.0, 0.52, 0, -0.24),
  part(0.48, 1.0, 0.48, -0.26, 0.26),
]);

/** Perimeter block around a courtyard. */
const courtyard = () => merge([
  part(1.0, 1.0, 0.22, 0, -0.39),
  part(1.0, 1.0, 0.22, 0, 0.39),
  part(0.22, 1.0, 0.56, -0.39, 0),
  part(0.22, 1.0, 0.56, 0.39, 0),
]);

/** Wide podium with a slim tower rising out of it. */
const podium = () => merge([
  part(1.0, 0.28, 1.0),
  part(0.52, 0.72, 0.52, 0, 0, -0.22),
]);

/** Twin wings of unequal height. */
const twin = () => merge([
  part(0.44, 1.0, 1.0, -0.28),
  part(0.44, 0.78, 1.0, 0.28),
]);

/** Tall street frontage with a lower rear wing. */
const stepped = () => merge([
  part(1.0, 1.0, 0.55, 0, -0.225),
  part(1.0, 0.62, 0.40, 0, 0.30),
]);

// ---- Civic and non-office stock -------------------------------------------
// A city isn't only offices. These give the docs, config, assets and styles in
// a repo their own building types, so a district of Markdown reads as a civic
// quarter and a pile of YAML reads as depots rather than more curtain wall.

/** Church: long low nave with a campanile at one end. */
const church = () => merge([
  part(0.62, 0.42, 1.0, -0.12, 0),        // nave
  part(0.30, 1.0, 0.34, 0.33, 0),         // tower
  part(0.16, 0.16, 0.16, 0.33, 0, 0.5),   // spire cap
]);

/** Civic hall: symmetrical centre block, flanking wings, entrance portico. */
const civicHall = () => merge([
  part(0.50, 1.0, 0.68, 0, -0.05),        // centre block
  part(0.24, 0.66, 0.58, -0.37, -0.05),   // left wing
  part(0.24, 0.66, 0.58, 0.37, -0.05),    // right wing
  part(0.38, 0.62, 0.16, 0, 0.40),        // portico
]);

/** Depot: long low shed with a raised roof monitor. */
const depot = () => merge([
  part(1.0, 0.58, 1.0),
  part(0.32, 0.16, 1.0, 0, 0, 0.08),      // clerestory strip
]);

/** Retail parade: low frontage with a projecting canopy. */
const retail = () => merge([
  part(1.0, 0.72, 0.84, 0, -0.08),
  part(1.0, 0.07, 0.22, 0, 0.39, -0.16),  // awning
]);

/** Utility plot: small plant block with a rooftop tank and mast. */
const utility = () => merge([
  part(0.78, 0.54, 0.78),
  part(0.30, 0.34, 0.30, -0.14, -0.10, 0.04),  // tank
  part(0.06, 0.42, 0.06, 0.26, 0.22, 0.04),    // mast
]);

export const ARCHETYPES = [
  { name: 'slab', build: slab },
  { name: 'setback', build: setback },
  { name: 'lshape', build: lshape },
  { name: 'courtyard', build: courtyard },
  { name: 'podium', build: podium },
  { name: 'twin', build: twin },
  { name: 'stepped', build: stepped },
  { name: 'church', build: church },
  { name: 'civicHall', build: civicHall },
  { name: 'depot', build: depot },
  { name: 'retail', build: retail },
  { name: 'utility', build: utility },
];

const A = {
  slab: 0, setback: 1, lshape: 2, courtyard: 3, podium: 4, twin: 5, stepped: 6,
  church: 7, civicHall: 8, depot: 9, retail: 10, utility: 11,
};

let cache = null;
/** Build (once) and return the archetype geometries. */
export function getArchetypeGeometries() {
  if (!cache) cache = ARCHETYPES.map((a) => a.build());
  return cache;
}

/**
 * What KIND of building a file becomes, from its language. This is what turns
 * an office park into a city: a folder of Markdown reads as a civic quarter,
 * a pile of YAML as a depot yard, stylesheets as a retail parade. Source code
 * keeps the commercial stock (towers, courtyards, slabs).
 */
function kindOf(lang) {
  switch (lang) {
    case 'Markdown':
      return 'civic';
    case 'YAML': case 'TOML': case 'JSON': case 'XML': case 'Shell':
      return 'works';
    case 'CSS': case 'SCSS': case 'Sass': case 'HTML':
      return 'retail';
    case 'SQL': case 'GraphQL':
      return 'works';
    case 'Other':
      // Licences, .gitignore, Dockerfiles, lockless odds and ends. Too many
      // of these to give them all a water tank — they're the ordinary small
      // stock that fills the gaps between everything else.
      return 'misc';
    default:
      return 'commercial'; // real source code
  }
}

/**
 * Pick a shape for a building. Kind comes from the language; within a kind,
 * form follows size the way it does in a real city — only substantial
 * buildings get towers, and anything small stays simple so the plan doesn't
 * turn to noise. `j` is the file's stable hash, so a file keeps its shape.
 */
export function pickArchetype(maxLoc, j, lang, minSide = Infinity) {
  // Complex massing needs room. On a small plot a mast, a tank or a set of
  // twin wings collapse to a few pixels and read as damage rather than
  // detail, so anything on a tight footprint stays a clean box no matter how
  // many lines it holds.
  if (minSide < 1.6) return A.slab;

  const kind = kindOf(lang);

  if (kind === 'civic') {
    if (maxLoc < 40) return A.retail;            // a notice board, not a church
    if (maxLoc < 400) return j < 0.55 ? A.civicHall : A.church;
    return j < 0.5 ? A.church : A.civicHall;
  }

  if (kind === 'misc') {
    if (maxLoc < 80) {
      if (j < 0.5) return A.slab;
      if (j < 0.72) return A.retail;
      return A.utility;
    }
    if (j < 0.4) return A.depot;
    if (j < 0.7) return A.slab;
    return A.lshape;
  }

  if (kind === 'works') {
    if (maxLoc < 30) return j < 0.6 ? A.utility : A.slab;
    if (maxLoc < 300) return j < 0.55 ? A.depot : A.utility;
    return j < 0.7 ? A.depot : A.courtyard;      // big yards read as depots
  }

  if (kind === 'retail') {
    if (maxLoc < 250) return A.retail;
    return j < 0.6 ? A.retail : A.stepped;       // parade over shops
  }

  // ---- Commercial: the office stock -------------------------------------
  // Tiny files: a shed is a shed. Complex massing on a 2m footprint just
  // reads as noise.
  if (maxLoc < 25) return A.slab;

  if (maxLoc < 120) {                            // low-rise
    if (j < 0.45) return A.slab;
    if (j < 0.72) return A.twin;
    return A.stepped;
  }

  if (maxLoc < 500) {                            // mid-rise
    if (j < 0.26) return A.stepped;
    if (j < 0.50) return A.lshape;
    if (j < 0.70) return A.twin;
    if (j < 0.86) return A.courtyard;
    return A.slab;
  }

  if (maxLoc < 1500) {                           // large block
    if (j < 0.30) return A.courtyard;
    if (j < 0.55) return A.lshape;
    if (j < 0.78) return A.podium;
    return A.setback;
  }

  // Landmarks. A building this tall should read as a tower, so only the
  // vertical archetypes apply — a courtyard stretched to 28 units tall looks
  // like a chimney, not a block.
  return j < 0.55 ? A.setback : A.podium;
}
