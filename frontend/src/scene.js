import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  planVillage,
  terrainWarpInner,
  buildSiteTerrain,
  buildPaddyFields,
  buildWaterRibbon,
  buildRoads,
  buildFeatureObjects,
  scatterTrees,
} from 'cheoma';

const BG = 0xb8c9c2; // soft sage daylight

// The 3D stage: renderer, camera, lights, ground, orbit controls, hover
// raycasting, and a render loop that fans out to per-frame subscribers.
// Lighting/ground setup adapted from grahambrooks/codecity (frontend/src/scene.js).
export class Scene {
  constructor(container) {
    this.container = container;
    this.frameCallbacks = [];
    this.hoverTargets = [];
    this.hovered = -1;
    this.onHover = null;      // (building, mouseEvent) => void
    this.onHoverIndex = null; // (instanceIndex) => void
    this.onSelect = null;     // (building | null) => void — a click, not a drag
    this.hitResolver = null;  // (intersection) => { building, index } | null
    this._resolved = null;    // what the pointer is over right now
    this._flight = null;      // an in-progress camera move
    this._raycastFrame = 0;   // throttle raycasting to every 3 frames

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-2, -2);

    this._init();
    this._lights();
    this._environment();
    this._ground();
    this._composer();
    this._events();
    this._animate();
  }

  /**
   * Image-based lighting. Without an environment, a PBR material has nothing
   * to reflect, so glazing renders as flat tinted paint no matter how low its
   * roughness is. A pre-filtered room probe gives every surface something to
   * pick up — which is what separates "material" from "coloured box".
   */
  _environment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.65;
    pmrem.dispose();
  }

  /**
   * Post-processing. Ambient occlusion is the single biggest realism win here:
   * it darkens the creases where buildings meet the ground and where wings
   * meet each other, which is exactly the contact shading that makes massing
   * read as solid rather than as decals floating on a plane.
   */
  _composer() {
    const { clientWidth: w, clientHeight: h } = this.container;

    // The renderer's own `antialias: true` only applies to the default
    // framebuffer. As soon as rendering goes through a composer it lands in a
    // render target instead and antialiasing is silently lost — which is why
    // post-processing makes edges turn jagged. Asking for a multisampled
    // target puts MSAA back.
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      type: THREE.HalfFloatType,
      samples: 2,
    });

    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const gtao = new GTAOPass(this.scene, this.camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 1.0;
    // Radius is in world units — tuned to the width of a street so occlusion
    // gathers between buildings without smearing across whole blocks.
    // Sample counts are deliberately low: AO here is broad contact shading,
    // not fine detail, and the denoise pass hides the reduced sampling. Full
    // 16/16 sampling costs roughly 3x the frame time for no visible gain at
    // city scale.
    gtao.updateGtaoMaterial({
      radius: 1.6,
      distanceExponent: 1.0,
      thickness: 1.0,
      scale: 1.0,
      samples: 2,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 2 });
    this.gtao = gtao;
    this.composer.addPass(gtao);

    // OutputPass applies tone mapping and the sRGB conversion at the end.
    this.composer.addPass(new OutputPass());
  }

  /** Render through the composer. Use this instead of renderer.render(). */
  render() {
    this.composer.render();
  }

  /** Resize renderer, camera and composer together. */
  setSize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
    if (this.labels) this.labels.setSize(w, h);
  }

  _init() {
    this.scene = new THREE.Scene();
    // A bright, softly fogged backdrop gives the tiled roofs and plaster walls
    // room to read without a harsh horizon behind the city.
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 260, 900);

    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 2000);
    this.camera.position.set(90, 90, 90);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Tone mapping keeps lit windows and accent roofs from clipping to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // Folder names float over their districts. CSS2D keeps them as real DOM
    // text — crisp at any zoom and styled by the same stylesheet as the UI.
    this.labels = new CSS2DRenderer();
    this.labels.setSize(w, h);
    Object.assign(this.labels.domElement.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none',
    });
    this.labels.domElement.className = 'label-layer';
    this.container.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 800;

    this.cityGroup = new THREE.Group();
    this.scene.add(this.cityGroup);
  }

  _lights() {
    // Warm daylight brings out the timber, plaster and celadon roof tones.
    this.scene.add(new THREE.AmbientLight(0xdce8dc, 0.75));

    const key = new THREE.DirectionalLight(0xffe2b0, 2.0);
    this.sunLight = key;
    key.position.set(90, 170, 70);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 500;
    const s = 160;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.5;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x8fb6a2, 0.5);
    rim.position.set(-80, 50, -90);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xc0ded4, 0x786751, 0.8));
  }

  _ground() {
    // The base plane IS the road surface — districts get painted on top, and
    // the gaps the treemap leaves between them become the street grid.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
        new THREE.MeshStandardMaterial({ color: 0xb7aa90, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // A low contrast stone grid keeps the street plan legible in daylight.
    const grid = new THREE.GridHelper(2400, 300, 0x948b78, 0xc7bda8);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.32;
    this.scene.add(grid);
  }

  /** Replace the floating district labels. `items` = [{ text, x, z, y }]. */
  setLabels(items) {
    for (const o of this._labelObjects || []) this.cityGroup.remove(o);
    this._labelObjects = items.map((it) => {
      const el = document.createElement('div');
      el.className = 'district-label';
      const dot = document.createElement('i');
      dot.style.background = it.color;
      const name = document.createElement('span');
      name.textContent = it.text;
      el.append(dot, name);
      const obj = new CSS2DObject(el);
      obj.position.set(it.x, it.y ?? 0.4, it.z);
      this.cityGroup.add(obj);
      return obj;
    });
  }

  /**
   * Glide the camera to look at `target` from `distance` away, keeping the
   * current viewing direction unless an explicit `dir` is given. Eased over a
   * short flight so a jump across the city stays spatially legible.
   */
  flyTo(target, distance, dir = null, duration = 0.8) {
    const t = new THREE.Vector3(target.x, target.y || 0, target.z);
    const d = (dir ? new THREE.Vector3(dir.x, dir.y, dir.z)
      : this.camera.position.clone().sub(this.controls.target)).normalize();
    this._flight = {
      p0: this.camera.position.clone(), t0: this.controls.target.clone(),
      p1: t.clone().add(d.multiplyScalar(distance)), t1: t,
      k: 0, dur: duration,
    };
  }

  /** Dolly in (factor < 1) or out (factor > 1) around the current target. */
  zoom(factor) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() * factor,
      this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target, len, off, 0.35);
  }

  _stepFlight(dt) {
    const f = this._flight;
    if (!f) return;
    f.k = Math.min(1, f.k + dt / f.dur);
    const e = f.k < 0.5 ? 4 * f.k ** 3 : 1 - (-2 * f.k + 2) ** 3 / 2; // easeInOutCubic
    this.camera.position.lerpVectors(f.p0, f.p1, e);
    this.controls.target.lerpVectors(f.t0, f.t1, e);
    if (f.k >= 1) this._flight = null;
  }

  _events() {
    window.addEventListener('resize', () => this._resize());
    // The container can start at 0×0 (e.g. before layout) and grow later —
    // keep the renderer matched to it however it changes.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this._resize()).observe(this.container);
    }
    const el = this.renderer.domElement;
    el.addEventListener('mousemove', (e) => this._mouseMove(e));
    el.addEventListener('mouseleave', () => {
      this.mouse.set(-2, -2);
      if (this.onHover) this.onHover(null);
      if (this.onHoverIndex) this.onHoverIndex(-1);
    });

    // A click selects; a drag orbits. OrbitControls owns the drag, so only a
    // press that barely moved counts as a click.
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 5 || !this.onSelect) return;
      this._mouseMove(e);
      this._raycast();
      this.onSelect(this._resolved ? this._resolved.building : null);
    });
    // Any manual orbit cancels an automated camera flight.
    this.controls.addEventListener('start', () => { this._flight = null; });
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return; // not laid out yet
    this.setSize(w, h);
  }

  _mouseMove(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this._mouseEvent = e;
  }

  _raycast() {
    if (!this.onHover || !this.hoverTargets.length) return;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.hoverTargets, false);

    // The city is a single InstancedMesh, so a hit carries an instanceId that
    // the resolver maps back to the building it represents.
    let resolved = null;
    if (hits.length && this.hitResolver) {
      for (const hit of hits) {
        resolved = this.hitResolver(hit);
        if (resolved) break;
      }
    }

    this._resolved = resolved;
    const key = resolved ? resolved.index : -1;
    if (key !== this.hovered) {
      this.hovered = key;
      if (this.onHoverIndex) this.onHoverIndex(key);
      // `index` is a building record, not a number, so test for presence.
      this.container.style.cursor = resolved ? 'pointer' : '';
    }

    this.onHover(resolved ? resolved.building : null, this._mouseEvent);
  }

  /** Register a callback run every frame with the delta seconds. Returns an unsubscribe fn. */
  onFrame(cb) {
    this.frameCallbacks.push(cb);
    return () => { this.frameCallbacks = this.frameCallbacks.filter((f) => f !== cb); };
  }

  setHoverTargets(meshes) { this.hoverTargets = meshes; }

  /**
   * Stand back far enough that the whole plan is legible at once, at the
   * raised three-quarter angle planning views use — high enough to read the
   * street grid, low enough to keep the extrusions three-dimensional.
   */
  frameCamera(radius, center = new THREE.Vector3(0, 0, 0)) {
    this._buildLandscape(radius, center);
    const dist = Math.max(radius * 1.75, 70);
    this.camera.position.set(
      center.x + dist * 0.62,
      dist * 0.78,
      center.z + dist * 0.62
    );
    this.controls.target.set(center.x, 0, center.z);
    this.controls.update();
  }

  /** Add a small, repeatable landscape around the city as a distant backdrop. */
  _buildLandscape(radius, center) {
    const citySize = Math.max(radius, 35);
    const key = `${Math.round(citySize * 10)}:${center.x.toFixed(2)}:${center.z.toFixed(2)}`;
    if (this.landscape && this.landscapeKey === key) return;

    if (this.landscape) {
      this._removeLandscapeFrame?.();
      this._removeLandscapeFrame = null;
      this.scene.remove(this.landscape);
      const geometries = new Set();
      const materials = new Set();
      this.landscape.traverse((object) => {
        if (!object.isMesh && !object.isInstancedMesh) return;
        if (object.geometry) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material) materials.add(material);
        }
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    }

    const landscape = new THREE.Group();
    landscape.name = 'town-landscape';
    landscape.position.set(center.x, 0, center.z);
    this.scene.add(landscape);
    this.landscape = landscape;
    this.landscapeKey = key;

    const siteR = Math.max(105, Math.min(260, citySize * 3.4));
    const plan = planVillage({ seed: 42, siteR });
    const site = plan.site;
    const clearRadius = citySize * 1.18;
    const countryside = new THREE.Group();
    countryside.name = 'cheoma-countryside';
    countryside.position.set(-site.center.x, 0, -site.center.z);
    landscape.add(countryside);

    // Use Cheoma's shaped basin and forested ridges, trimming the central
    // footprint so the repository buildings and streets stay unobstructed.
    const warpInner = terrainWarpInner(plan, site);
    const terrain = buildSiteTerrain(site, null, warpInner, null);
    this._trimLandscapeToRing(terrain.mesh, site.center, clearRadius);
    countryside.add(terrain.mesh);

    const nearCityPaddies = (plan.paddies || []).filter((field) => {
      const cx = field.poly.reduce((sum, point) => sum + point.x, 0) / field.poly.length;
      const cz = field.poly.reduce((sum, point) => sum + point.z, 0) / field.poly.length;
      const extent = Math.max(...field.poly.map((point) => Math.hypot(point.x - cx, point.z - cz)));
      return Math.hypot(cx - site.center.x, cz - site.center.z) - extent > clearRadius * 1.08;
    });
    if (nearCityPaddies.length) countryside.add(buildPaddyFields(site, nearCityPaddies));

    const waterUniforms = {
      uTime: { value: 0 },
      uSky: { value: new THREE.Color(0xaecbe0) },
      uRipple: { value: 1 },
      uFlow: { value: new THREE.Vector2(-1, 0.12) },
      uGlint: { value: new THREE.Vector3(0.85, 0.74, 0.48) },
      uRough: { value: 0 },
      uWaterTint: { value: new THREE.Color(1, 1, 1) },
      uWaterDesat: { value: 0 },
    };
    const stream = buildWaterRibbon(site, waterUniforms);
    if (stream) countryside.add(stream);

    const roads = buildRoads(site, plan.roads || []);
    this._trimLandscapeToRing(roads, site.center, clearRadius * 1.08);
    countryside.add(roads);

    const outsideCity = (feature) =>
      feature && Math.hypot(feature.x - site.center.x, feature.z - site.center.z) > clearRadius * 1.45;
    const features = plan.features || {};
    const landmarks = buildFeatureObjects({
      ...plan,
      features: {
        ...features,
        pavilion: outsideCity(features.pavilion) ? features.pavilion : null,
        bridges: (features.bridges || []).filter(outsideCity),
        props: (features.props || []).filter(outsideCity),
        ferry: outsideCity(features.ferry) ? features.ferry : null,
        temple: null,
        palace: null,
      },
    }, site);
    landmarks.forEach((landmark) => countryside.add(landmark));

    const isInsidePaddy = (x, z, polygon) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        if (((a.z > z) !== (b.z > z)) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    const nearRoad = (x, z, extra = 0) => (plan.roads || []).some((road) => {
      const pts = road.pts || [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
        if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < road.width * 0.6 + extra) return true;
      }
      return false;
    });
    const treeMask = (x, z, canopyRadius = 0) =>
      Math.hypot(x - site.center.x, z - site.center.z) < clearRadius
      || nearRoad(x, z, canopyRadius)
      || nearCityPaddies.some((field) => isInsidePaddy(x, z, field.poly));
    const trees = scatterTrees(site, treeMask, plan.seed, warpInner, 0.7);
    countryside.add(trees);

    // A warm gradient sky and low sun echo Cheoma's sunset reference, while
    // the actual landforms, forest, stream and field geometry come from Cheoma.
    const sunDirection = new THREE.Vector3(-0.66, 0.48, -0.58).normalize();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          zenith: { value: new THREE.Color(0x8caeaf) },
          horizon: { value: new THREE.Color(0xf2dfbd) },
          sunGlow: { value: new THREE.Color(0xf4c47d) },
          sunDirection: { value: sunDirection },
        },
        vertexShader: `varying vec3 vSkyDirection; void main() { vSkyDirection = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          varying vec3 vSkyDirection;
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 sunGlow;
          uniform vec3 sunDirection;
          void main() {
            float height = smoothstep(-0.16, 0.78, vSkyDirection.y);
            vec3 sky = mix(horizon, zenith, height);
            float glow = pow(max(dot(normalize(vSkyDirection), normalize(sunDirection)), 0.0), 7.0);
            sky = mix(sky, sunGlow, glow * 0.46);
            gl_FragColor = vec4(sky, 1.0);
          }
        `,
      })
    );
    sky.name = 'sunset-sky';
    sky.scale.setScalar(Math.max(700, citySize * 12));
    sky.renderOrder = -1000;
    landscape.add(sky);

    const sunRadius = Math.max(3.5, citySize * 0.095);
    const sunPosition = sunDirection.clone().multiplyScalar(citySize * 5.5);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(sunRadius, 32, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd181, toneMapped: false })
    );
    sun.position.copy(sunPosition);
    sun.name = 'sun-disc';
    landscape.add(sun);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(sunRadius * 1.8, 32, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd99b, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false })
    );
    halo.position.copy(sunPosition);
    landscape.add(halo);
    this.sunLight?.position.set(sunDirection.x * citySize * 4, sunDirection.y * citySize * 4, sunDirection.z * citySize * 4);

    this.scene.background = new THREE.Color(0xd9d8c7);
    this.scene.fog = new THREE.Fog(0xd9d8c7, citySize * 3.7, citySize * 8.5);
    this._landscapeWaterUniforms = waterUniforms;
    this._removeLandscapeFrame = this.onFrame((dt) => { waterUniforms.uTime.value += dt; });
  }

  _trimLandscapeToRing(root, center, radius) {
    root.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    root.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh) return;
      const geometry = object.geometry;
      const positions = geometry?.attributes?.position;
      const index = geometry?.index;
      if (!positions || !index) return;
      const kept = [];
      const matrix = object.matrixWorld;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(positions, index.getX(i)).applyMatrix4(matrix);
        b.fromBufferAttribute(positions, index.getX(i + 1)).applyMatrix4(matrix);
        c.fromBufferAttribute(positions, index.getX(i + 2)).applyMatrix4(matrix);
        if (
          Math.hypot(a.x - center.x, a.z - center.z) >= radius
          && Math.hypot(b.x - center.x, b.z - center.z) >= radius
          && Math.hypot(c.x - center.x, c.z - center.z) >= radius
        ) kept.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
      geometry.setIndex(kept);
      geometry.computeBoundingSphere();
    });
  }

  _animate() {
    this._clock = this._clock || new THREE.Clock();
    requestAnimationFrame(() => this._animate());
    const dt = this._clock.getDelta();
    for (const cb of this.frameCallbacks) cb(dt);
    this._stepFlight(dt);
    this.controls.update();
    // Another view is on screen: keep the city's clock running, skip the GPU work.
    if (this.paused) return;
    // Throttle raycasting to every 3 frames for better performance
    this._raycastFrame++;
    if (this._raycastFrame % 3 === 0) this._raycast();
    this.render();
    this.labels.render(this.scene, this.camera);
  }
}
