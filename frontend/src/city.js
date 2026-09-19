import * as THREE from 'three';
import { getArchetypeGeometries, pickArchetype } from './shapes.js';

const MIN_H = 0.6;     // world height of a 1-line file
const MAX_H = 28;      // world height of the biggest file ever
const GROW_SPEED = 7;  // higher = snappier height transitions
// Buildings do not start rising the instant their file appears. They join a
// queue and are released a few per second, so the city is always assembling
// one building at a time no matter how many files a single commit added — an
// initial scaffold commit can add sixty at once, and raising those together
// reads as one slab heaving out of the ground rather than a city being built.
//
// This paces the ANIMATION only. The data is untouched: every building still
// carries the exact line count of its file at every commit.
const BIRTH_RATE = 7;      // buildings released per second, baseline
const BIRTH_CATCHUP = 4.0; // a backlog is cleared within roughly this long
const HEAT_WINDOW = 5; // commits over which a "just changed" glow fades
const EPS = 0.004;     // height delta below which we stop rewriting a matrix

// One shared unit box for every building. All buildings live in a single
// InstancedMesh, so a 10k-file repo costs ONE draw call instead of 10k.
const UNIT = new THREE.BoxGeometry(1, 1, 1);

// Accent colours follow the UI's design system, where colour is functional:
// violet marks the thing you're working with, emerald marks activity, and
// anything filtered out drops to a zinc grey that also drains its windows.
const SELECT_COLOR = new THREE.Color(0xa78bfa);
const HEAT_COLOR = new THREE.Color(0x34d399);
const HOVER_COLOR = new THREE.Color(0xffffff);
const MUTED_COLOR = new THREE.Color(0x1c1c21);

/**
 * The city is drawn at night, to sit inside the Obsidian UI (near-black,
 * zinc surfaces, violet/emerald accents). Each instance's colour is the
 * building's ACCENT — its language colour, or violet when selected, emerald
 * when just changed, grey when filtered out — and the shader derives the rest
 * from it: a dark zinc body, an accent-coloured roof, and windows lit from
 * inside. Keeping everything driven by one instance colour means hover,
 * selection, heat and filtering all stay a single `setColorAt`, and the whole
 * city is still one draw call per building shape.
 */
const FLOOR_H = 0.8;  // world units per storey
const BAY_W = 0.52;   // world units per structural bay (pilaster + glazing)

function planMaterial({
  mode = 'building', edgeWidth = 1.9, shapes = false, ...opts
} = {}) {
  const building = mode === 'building';
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // modulated per-instance via instanceColor
    roughness: 0.78,
    metalness: 0.0,
    ...opts,
  });
  // USE_UV makes three declare the uv attribute AND the vUv varying for us.
  mat.defines = { ...(mat.defines || {}), USE_UV: '' };
  // Only archetype geometry carries the aWidthFrac attribute.
  if (shapes) mat.defines.PLAN_SHAPES = '';

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObjN;
        varying vec3 vWorld;
        varying vec3 vScale;
        varying float vWidthFrac;
        #ifdef PLAN_SHAPES
          attribute float aWidthFrac;
        #endif`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vObjN = normal;
        #ifdef PLAN_SHAPES
          vWidthFrac = aWidthFrac;
        #else
          vWidthFrac = 1.0;
        #endif
        // Recover this instance's world size from its matrix columns, so the
        // facade can be laid out in world units instead of stretched UVs.
        vec4 _wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          vScale = vec3(
            length(instanceMatrix[0].xyz),
            length(instanceMatrix[1].xyz),
            length(instanceMatrix[2].xyz)
          );
          _wp = instanceMatrix * _wp;
        #else
          vScale = vec3(1.0);
        #endif
        vWorld = (modelMatrix * _wp).xyz;`
      );

    const surface = building ? `
          // ---- Building --------------------------------------------------
          vec3 accent = diffuseColor.rgb;
          // How "switched on" this building is. A filtered-out building gets a
          // dim grey accent, which drains its windows and roof along with it.
          float energy = max(max(accent.r, accent.g), accent.b);

          float side = 1.0 - step(0.9, abs(vObjN.y));
          float roof = step(0.9, vObjN.y);
          float h = max(vScale.y, 1e-4);

          // Dark zinc body with a trace of the accent, so a district of one
          // language still reads as related from the side.
          vec3 wall = vec3(0.066, 0.068, 0.080) + accent * 0.055;
          diffuseColor.rgb = wall;

          // Facade as structural BAYS, not a grid of dots: pilaster strip,
          // recessed glazing, slab line at every storey. Both rhythms are in
          // WORLD units so every building shares one storey height and bay
          // width, and the facade stays put as a building grows on the
          // timeline — new storeys stack on top rather than rescaling.
          float faceW = mix(vScale.x, vScale.z, step(0.5, abs(vObjN.x))) * vWidthFrac;
          float bxRaw = vUv.x * faceW / ${BAY_W.toFixed(2)};
          float fyRaw = (vWorld.y - 0.30) / ${FLOOR_H.toFixed(2)};
          float bx = fract(bxRaw);
          float fy = fract(fyRaw);
          float bw = fwidth(bx) * 1.5 + 0.02;
          float fw = fwidth(fy) * 1.5 + 0.03;
          float bay = smoothstep(0.28 - bw, 0.28 + bw, bx)
                    * (1.0 - smoothstep(0.84 - bw, 0.84 + bw, bx));
          float slab = smoothstep(0.80 - fw, 0.80 + fw, fy);
          float glass = bay * (1.0 - slab) * side;
          // Solid plinth, parapet, and no facade on anything too short to
          // have storeys.
          glass *= smoothstep(0.18, 0.5, vWorld.y);
          glass *= 1.0 - smoothstep(h - 0.34, h - 0.10, vWorld.y);
          glass *= smoothstep(0.7, 1.5, h);
          gGlass = glass;

          // Not every window is lit — a uniformly glowing grid reads as a
          // texture, a scatter of lit and dark ones reads as a building with
          // people in it. Each window cell hashes its own on/off state.
          vec3 cell = vec3(floor(bxRaw) + floor(vWorld.x * 3.1),
                           floor(fyRaw),
                           floor(vWorld.z * 3.1) + vObjN.x * 7.0 + vObjN.z * 13.0);
          float rnd = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float lit = step(0.46, rnd);

          vec3 pane = mix(wall * 0.55, vec3(0.10, 0.11, 0.14), 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, pane, glass);

          // Real walls have thickness, so glazing sits in a reveal: the head
          // and one jamb fall into shadow. Without it a window is a decal.
          float head = smoothstep(0.80, 0.62, fy);
          float jamb = smoothstep(0.28, 0.40, bx);
          float reveal = glass * (1.0 - head * 0.55) * (1.0 - (1.0 - jamb) * 0.35);

          // Warm interior light, pulled toward the building's own accent.
          vec3 room = mix(vec3(1.0, 0.83, 0.58), accent, 0.30);
          totalEmissiveRadiance += room * lit * reveal * energy * 0.62;

          // Accent-coloured roof: from above, the city reads as a language
          // map; from the side, as dark towers with lit windows.
          diffuseColor.rgb = mix(diffuseColor.rgb, accent * 0.9, roof * 0.82);
          totalEmissiveRadiance += accent * roof * energy * 0.10;
    ` : `
          // ---- District plate ---------------------------------------------
          // Dark ground zone; its tint arrives via the instance colour.
    `;

    const edges = building ? `
          // Chamfered edges: perfectly sharp corners read as CG. One side of
          // every border catches light, the other falls into shade.
          float lit2 = min(dl, dt);
          float shd  = min(dr, db);
          float facing = step(lit2, shd);
          vec3 catchLight = diffuseColor.rgb + vec3(0.07, 0.07, 0.09);
          diffuseColor.rgb = mix(diffuseColor.rgb,
                                 mix(diffuseColor.rgb * 0.55, catchLight, facing), e);
    ` : `
          // A thin lighter border around each zone, the way the UI separates
          // surfaces with 1px outlines rather than shadows.
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.9 + vec3(0.05), e * 0.9);
    `;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObjN;
        varying vec3 vWorld;
        varying vec3 vScale;
        varying float vWidthFrac;
        // How glazed this fragment is, shared from the colour stage down to
        // the roughness/metalness stage further along the shader.
        float gGlass;`
      )
      // Glazing is glass, not paint: smooth and slightly metallic so it
      // catches the environment probe.
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16, gGlass);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, gGlass);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          gGlass = 0.0;
          ${surface}

          float dl = vUv.x, dr = 1.0 - vUv.x;
          float db = vUv.y, dt = 1.0 - vUv.y;
          float d  = min(min(dl, dr), min(db, dt));
          // fwidth keeps edges a constant thickness on screen at any zoom.
          float w  = fwidth(d) * ${edgeWidth.toFixed(2)};
          float e  = 1.0 - smoothstep(0.0, max(w, 1e-5), d);
          ${edges}
        }`
      );
  };
  // Distinct key so three doesn't share a cached program with another variant.
  mat.customProgramCacheKey = () => `night-${mode}-${edgeWidth}-${shapes}`;
  return mat;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Stable 32-bit hash of a string, used for deterministic colour variation. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Owns the instanced building mesh (the union of all files that ever existed)
 * plus the district ground plates, and animates building heights as the
 * timeline commit index changes.
 */
export class City {
  constructor(scene, data) {
    this.scene = scene;
    this.data = data;
    this.t = 0;
    this.hovered = null;
    this.selected = null;
    this.heatOn = true;
    this.itemByPath = new Map();
    this.birthQueue = [];
    this._birthCredit = 0;

    const list = data.buildings;
    this.n = list.length;
    this.items = new Array(this.n);

    const maxLocGlobal = Math.max(1, ...list.map((b) => b.maxLoc));
    this.sqrtMax = Math.sqrt(maxLocGlobal);

    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };

    // Assign every building a shape first, so each archetype's InstancedMesh
    // can be allocated at exactly the right size.
    const geoms = getArchetypeGeometries();
    const buckets = geoms.map(() => []);
    for (let i = 0; i < this.n; i++) {
      const b = list[i];
      const a = pickArchetype(
        b.maxLoc,
        hash(b.path + '#shape'),
        b.lang,
        Math.min(b.plot.w, b.plot.d)
      );
      buckets[a].push(i);
    }

    // One mesh per archetype — seven draw calls total, regardless of how many
    // buildings the repo has.
    this.groups = geoms.map((geo, a) => {
      if (!buckets[a].length) return null;
      const mesh = new THREE.InstancedMesh(
        geo,
        planMaterial({ mode: 'building', shapes: true }),
        buckets[a].length
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      return { mesh, items: [], matrixDirty: false, colorDirty: false };
    });

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (let a = 0; a < buckets.length; a++) {
      const g = this.groups[a];
      if (!g) continue;

      buckets[a].forEach((i, gi) => {
        const b = list[i];

        // The instance colour is this building's ACCENT: the shader turns it
        // into a lit roof and warm windows over a dark body. GitHub's palette
        // is normalised into one lightness band so no language glares at
        // night and none disappears, and hue is nudged per file so
        // neighbours of one language stay individually readable.
        const base = new THREE.Color(b.color);
        base.getHSL(hsl);
        const j = hash(b.path);
        base.setHSL(
          (hsl.h + (j - 0.5) * 0.04 + 1) % 1,
          clamp(hsl.s * 0.9, 0.35, 0.75),
          clamp(0.62 + (j - 0.5) * 0.08, 0.55, 0.68)
        );

        const item = {
          b, base, h: 0, targetH: 0, heat: 0, loc: 0, dirty: true, g: a, gi,
          queued: false,
        };
        this.items[i] = item;
        this.itemByPath.set(b.path, item);
        g.items[gi] = item;
        g.mesh.setColorAt(gi, base);
        this._writeMatrix(item, 0);

        minX = Math.min(minX, b.plot.x); maxX = Math.max(maxX, b.plot.x);
        minZ = Math.min(minZ, b.plot.z); maxZ = Math.max(maxZ, b.plot.z);
      });

      g.mesh.instanceMatrix.needsUpdate = true;
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
    }

    this.radius = Math.max(maxX - minX, maxZ - minZ) / 2 || 40;

    const meshes = [];
    for (const g of this.groups) {
      if (!g) continue;
      // Generous manual bounds so instanced raycasting never misses due to a
      // stale sphere as buildings grow.
      g.mesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, MAX_H / 2, 0),
        this.radius * 1.6 + MAX_H
      );
      scene.cityGroup.add(g.mesh);
      meshes.push(g.mesh);
    }

    this._buildDistricts(data.districts || []);

    // Hover: a hit carries the mesh it struck plus an instanceId, which maps
    // back through that archetype's group to the building. Ground plates are
    // not hover targets, so only buildings respond.
    const groupByMesh = new Map();
    for (const g of this.groups) if (g) groupByMesh.set(g.mesh, g);
    scene.setHoverTargets(meshes);
    scene.hitResolver = (hit) => {
      if (!hit || hit.instanceId == null) return null;
      const g = groupByMesh.get(hit.object);
      const item = g && g.items[hit.instanceId];
      return item && item.h > 0.03 ? { building: item.b, index: item } : null;
    };

    this._unsub = scene.onFrame((dt) => this._tick(dt));
    this.setCommit(0);
  }

  /**
   * Paint each folder as a coloured zone on the ground. Deeper folders stack
   * slightly higher so nesting is visible, and the gaps the treemap left
   * between zones become the street grid.
   */
  _buildDistricts(districts) {
    if (!districts.length) { this.plates = null; return; }

    // Deepest zones drawn highest so they sit on top of their parent.
    const sorted = [...districts].sort((a, b) => a.depth - b.depth);
    this.districts = sorted;

    const plates = new THREE.InstancedMesh(
      UNIT,
      planMaterial({ mode: 'plate', edgeWidth: 1.4, roughness: 0.95 }),
      sorted.length
    );
    plates.receiveShadow = true;
    plates.castShadow = false;
    plates.frustumCulled = false;

    const m = new THREE.Matrix4();
    this.plateBase = new Array(sorted.length);
    this.plateLive = new Int32Array(sorted.length);
    this.plateWasLive = new Int8Array(sorted.length).fill(-1);

    const indexByPath = new Map();

    sorted.forEach((d, i) => {
      const thickness = 0.12;
      const y = 0.04 + d.depth * 0.07;
      m.makeScale(d.w, thickness, d.d);
      m.setPosition(d.x, y, d.z);
      plates.setMatrixAt(i, m);

      // One hue per folder, kept very dark — zones are ground, and on a
      // near-black canvas the buildings standing on them carry the colour.
      const j = hash(d.path || d.name || String(i));
      const c = new THREE.Color().setHSL(j, 0.28, 0.085 + Math.min(d.depth, 3) * 0.018);
      this.plateBase[i] = c;
      plates.setColorAt(i, c);
      indexByPath.set(d.path, i);
    });

    // Map each building to every zone that contains it, so a plate can be
    // dimmed the moment its last building is demolished.
    for (const x of this.items) {
      const chain = [];
      let p = x.b.district;
      while (p && p !== '(root)') {
        const idx = indexByPath.get(p);
        if (idx !== undefined) chain.push(idx);
        const cut = p.lastIndexOf('/');
        if (cut < 0) break;
        p = p.slice(0, cut);
      }
      x.zones = chain;
    }

    plates.instanceMatrix.needsUpdate = true;
    if (plates.instanceColor) plates.instanceColor.needsUpdate = true;
    plates.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), this.radius * 2 + 10);

    this.plates = plates;
    this.scene.cityGroup.add(plates);
  }

  /**
   * Grey out zones that hold no living buildings at the current commit. A
   * district whose files were all deleted then reads as cleared land instead
   * of a large empty slab of colour.
   */
  _refreshPlates() {
    if (!this.plates) return;
    let dirty = false;
    const dim = new THREE.Color(0x0c0c0f);
    const c = new THREE.Color();
    for (let i = 0; i < this.plateLive.length; i++) {
      const live = this.plateLive[i] > 0 ? 1 : 0;
      if (this.plateWasLive[i] === live) continue;
      this.plateWasLive[i] = live;
      c.copy(this.plateBase[i]);
      if (!live) c.lerp(dim, 0.75);
      this.plates.setColorAt(i, c);
      dirty = true;
    }
    if (dirty && this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
  }

  heightForLoc(loc) {
    if (loc <= 0) return 0;
    return MIN_H + (Math.sqrt(loc) / this.sqrtMax) * (MAX_H - MIN_H);
  }

  /** Set the active commit index; recompute each building's target + heat. */
  setCommit(t) {
    this.t = t;
    let alive = 0;
    if (this.plateLive) this.plateLive.fill(0);

    for (let i = 0; i < this.n; i++) {
      const x = this.items[i];
      const { loc, c } = locAt(x.b.history, t);
      x.loc = loc;
      const target = this.heightForLoc(loc);
      if (target !== x.targetH) {
        // Newly born (nothing there before, something now): join the queue
        // rather than rising immediately.
        if (x.targetH === 0 && target > 0 && x.h <= 0.0001 && !x.queued) {
          x.queued = true;
          this.birthQueue.push(x);
        }
        x.targetH = target;
        x.dirty = true;
      }
      const heat = this.heatOn && loc > 0 && c >= 0 ? Math.max(0, 1 - (t - c) / HEAT_WINDOW) : 0;
      if (heat !== x.heat) { x.heat = heat; x.colorDirty = true; }
      if (loc > 0) {
        alive++;
        // Same pass tallies zone occupancy, so plate state costs nothing extra.
        if (x.zones) for (const z of x.zones) this.plateLive[z]++;
      }
    }

    this._refreshPlates();
    return alive;
  }

  /**
   * Release the whole birth queue at once. Called when the user drags the
   * scrubber — pacing exists to make playback read well, but someone
   * scrubbing wants the state under their cursor immediately.
   */
  snap() {
    for (const x of this.birthQueue) { x.queued = false; x.dirty = true; }
    this.birthQueue.length = 0;
    this._birthCredit = 0;
  }

  aliveAt(t) {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (locAt(this.items[i].b.history, t).loc > 0) n++;
    return n;
  }

  /** Select a building (by its data record or path), or clear with null. */
  select(target) {
    const b = typeof target === 'string' ? { path: target } : target;
    const next = b ? this.itemByPath.get(b.path) || null : null;
    if (next === this.selected) return next;
    if (this.selected) this.selected.colorDirty = true;
    this.selected = next;
    if (next) next.colorDirty = true;
    return next;
  }

  /**
   * Show only the given languages; everything else drops to grey. Pass null
   * to show everything. Filtering never hides a building — the city keeps its
   * shape, so you can still see where the filtered-out code sits.
   */
  setLanguageFilter(langs) {
    const keep = langs && langs.size ? langs : null;
    for (const x of this.items) {
      const muted = keep ? !keep.has(x.b.lang) : false;
      if (muted !== !!x.muted) { x.muted = muted; x.colorDirty = true; }
    }
  }

  /** Turn the emerald "just changed" glow on or off. */
  setHeat(on) {
    this.heatOn = !!on;
    if (this.t != null) this.setCommit(this.t);
  }

  /**
   * One label per top-level folder (falling back to the next level down when
   * the repo has a single root folder), placed on the zone's front edge.
   */
  districtLabels() {
    const ds = this.districts || [];
    let pick = ds.filter((d) => d.depth === 1);
    if (pick.length <= 1) {
      const deeper = ds.filter((d) => d.depth === 2);
      if (deeper.length > 1) pick = deeper;
    }
    return pick.map((d) => {
      const c = new THREE.Color().setHSL(hash(d.path || d.name || ''), 0.55, 0.62);
      return {
        text: d.name || d.path.split('/').pop(),
        x: d.x, y: 0.5, z: d.z + d.d / 2,
        color: `#${c.getHexString()}`,
      };
    });
  }

  /** Centre and footprint of the zone holding the most code — "downtown". */
  core() {
    const ds = (this.districts || []).filter((d) => d.depth === 1);
    if (!ds.length) return { x: 0, z: 0, size: this.radius };
    const weight = new Map();
    for (const x of this.items) {
      const top = x.b.path.includes('/') ? x.b.path.split('/')[0] : null;
      if (top) weight.set(top, (weight.get(top) || 0) + x.b.maxLoc);
    }
    const best = ds.reduce((a, d) => ((weight.get(d.path) || 0) > (weight.get(a.path) || 0) ? d : a), ds[0]);
    return { x: best.x, z: best.z, size: Math.max(best.w, best.d) };
  }

  /** World-space top-centre of a building as it stands now, for camera focus. */
  anchorOf(building) {
    const x = this.itemByPath.get(building.path);
    if (!x) return null;
    const { plot } = x.b;
    return { x: plot.x, y: Math.max(x.h, this.heightForLoc(x.b.maxLoc) * 0.5), z: plot.z,
      size: Math.max(plot.w, plot.d) };
  }

  /** `item` is the record handed back by the hit resolver, or -1 / null. */
  setHover(item) {
    const next = item && item.b ? item : null;
    if (next === this.hovered) return;
    if (this.hovered) this.hovered.colorDirty = true;
    this.hovered = next;
    if (next) next.colorDirty = true;
  }

  _writeMatrix(item, h) {
    const { plot } = item.b;
    if (h <= 0.0001) {
      this._m.makeScale(0, 0, 0);
      this._m.setPosition(plot.x, 0, plot.z);
    } else {
      this._m.makeScale(plot.w, h, plot.d);
      this._m.setPosition(plot.x, h / 2, plot.z);
    }
    this.groups[item.g].mesh.setMatrixAt(item.gi, this._m);
  }

  /**
   * Release queued buildings at a steady rate so they break ground one after
   * another. The rate rises with the backlog, so a commit that adds hundreds
   * of files still clears in a few seconds instead of falling permanently
   * behind the playhead.
   */
  _releaseBirths(dt) {
    const q = this.birthQueue;
    if (!q.length) { this._birthCredit = 0; return; }

    const rate = Math.max(BIRTH_RATE, q.length / BIRTH_CATCHUP);
    this._birthCredit += rate * dt;

    while (this._birthCredit >= 1 && q.length) {
      this._birthCredit -= 1;
      const x = q.shift();
      x.queued = false;
      // It may have been deleted again before its turn came up.
      if (x.targetH > 0) x.dirty = true;
    }
  }

  _tick(dt) {
    this._releaseBirths(dt);
    const k = Math.min(1, dt * GROW_SPEED);

    for (let i = 0; i < this.n; i++) {
      const x = this.items[i];
      const g = this.groups[x.g];

      if (x.queued) {
        // Waiting its turn to break ground — hold at zero height.
      } else if (x.dirty || Math.abs(x.targetH - x.h) > EPS) {
        x.h += (x.targetH - x.h) * k;
        if (Math.abs(x.targetH - x.h) <= EPS) { x.h = x.targetH; x.dirty = false; }
        this._writeMatrix(x, x.h);
        g.matrixDirty = true;
      }

      if (x.colorDirty) {
        if (x === this.selected) {
          this._c.copy(SELECT_COLOR);
        } else if (x.muted) {
          this._c.copy(MUTED_COLOR);
        } else {
          this._c.copy(x.base);
          if (x.heat > 0.01) this._c.lerp(HEAT_COLOR, Math.min(0.75, x.heat * 0.8));
        }
        if (x === this.hovered) this._c.lerp(HOVER_COLOR, x.muted ? 0.15 : 0.35);
        g.mesh.setColorAt(x.gi, this._c);
        x.colorDirty = false;
        g.colorDirty = true;
      }
    }

    for (const g of this.groups) {
      if (!g) continue;
      if (g.matrixDirty) { g.mesh.instanceMatrix.needsUpdate = true; g.matrixDirty = false; }
      if (g.colorDirty && g.mesh.instanceColor) {
        g.mesh.instanceColor.needsUpdate = true;
        g.colorDirty = false;
      }
    }
  }

  /** Live LOC for a building at the current commit (for the tooltip). */
  locOf(building) {
    return locAt(building.history, this.t).loc;
  }

  dispose() {
    if (this._unsub) this._unsub();
    this.scene.setHoverTargets([]);
    this.scene.hitResolver = null;
    this.hovered = null;
    this.selected = null;
    this.itemByPath.clear();
    for (const g of this.groups || []) {
      if (!g) continue;
      this.scene.cityGroup.remove(g.mesh);
      g.mesh.material.dispose();
      g.mesh.dispose(); // shared archetype geometry is NOT disposed — reused
    }
    this.groups = [];
    if (this.plates) {
      this.scene.cityGroup.remove(this.plates);
      this.plates.material.dispose();
      this.plates.dispose();
      this.plates = null;
    }
    this.items = [];
    this.n = 0;
  }
}

/** Binary search: last history point with c <= t. */
export function locAt(history, t) {
  if (!history.length || t < history[0].c) return { loc: 0, c: -1 };
  let lo = 0, hi = history.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].c <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return { loc: history[ans].loc, c: history[ans].c };
}
