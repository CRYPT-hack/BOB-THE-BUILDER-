import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
    this.hitResolver = null;  // (intersection) => { building, index } | null

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
    this.scene.environmentIntensity = 0.45;
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
      samples: 4,
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
      samples: 6,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 6 });
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
  }

  _init() {
    this.scene = new THREE.Scene();
    // A planning drawing reads on paper, not in a void: bright ground, hazy
    // horizon, colour doing the talking.
    this.scene.background = new THREE.Color(0xdfe4ec);
    // Fog starts beyond the far edge of a framed city, so haze reads as
    // atmosphere on the horizon rather than washing out the plan itself.
    this.scene.fog = new THREE.Fog(0xdfe4ec, 340, 1100);

    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.1, 2000);
    this.camera.position.set(90, 90, 90);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Tone mapping keeps the saturated zone colours from blowing out to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 800;

    this.cityGroup = new THREE.Group();
    this.scene.add(this.cityGroup);
  }

  _lights() {
    // Soft overcast key light: crisp enough for readable shadows between
    // blocks, flat enough that every zone colour stays legible.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const key = new THREE.DirectionalLight(0xfff6e8, 1.05);
    key.position.set(90, 170, 70);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
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

    const fill = new THREE.DirectionalLight(0xcfe0ff, 0.35);
    fill.position.set(-70, 60, -60);
    this.scene.add(fill);

    this.scene.add(new THREE.HemisphereLight(0xeaf2ff, 0xa8aeb8, 0.35));
  }

  _ground() {
    // The base plane IS the road surface — districts get painted on top, and
    // the gaps the treemap leaves between them become the street grid.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ color: 0xaeb5c0, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
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

    const key = resolved ? resolved.index : -1;
    if (key !== this.hovered) {
      this.hovered = key;
      if (this.onHoverIndex) this.onHoverIndex(key);
      this.container.style.cursor = key >= 0 ? 'pointer' : 'default';
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
    const dist = Math.max(radius * 1.75, 70);
    this.camera.position.set(
      center.x + dist * 0.62,
      dist * 0.78,
      center.z + dist * 0.62
    );
    this.controls.target.set(center.x, 0, center.z);
    this.controls.update();
  }

  _animate() {
    this._clock = this._clock || new THREE.Clock();
    requestAnimationFrame(() => this._animate());
    const dt = this._clock.getDelta();
    for (const cb of this.frameCallbacks) cb(dt);
    this.controls.update();
    this._raycast();
    this.render();
  }
}
