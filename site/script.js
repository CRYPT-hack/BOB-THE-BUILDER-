/* =========================================================
   BOB THE BUILDER — landing page interactions
   Kept deliberately small: the layout and every animation live
   in CSS. This file only generates the city's markup and drives
   the handful of things CSS can't express on its own.
   ========================================================= */

/* ---------- 1. The city that builds itself ---------------
   Mirrors the real app's metaphor: coloured folder zones on the
   ground, buildings placed inside them, each rising in sequence
   rather than all at once. The stagger is an animation-delay, so
   the motion itself is still CSS. */

const ZONES = [
  { x:  4, y: 14, w: 40, h: 50, c: '#8fd8cf' },
  { x: 48, y: 10, w: 25, h: 39, c: '#b9a8f0' },
  { x: 76, y: 15, w: 20, h: 35, c: '#f0a8cf' },
  { x:  8, y: 70, w: 36, h: 22, c: '#e8dc9a' },
  { x: 47, y: 55, w: 26, h: 38, c: '#f2b79a' },
  { x: 76, y: 57, w: 20, h: 33, c: '#a8c8f0' },
];

// Deterministic PRNG so the skyline is identical on every visit.
let seed = 20260910;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const city = document.getElementById('city');
let buildings = [];

function buildCity() {
  if (!city) return;
  city.innerHTML = '';
  buildings = [];
  seed = 20260910;

  ZONES.forEach((z, zi) => {
    const plate = document.createElement('div');
    plate.className = 'zone';
    plate.style.cssText =
      `left:${z.x}%;top:${z.y}%;width:${z.w}%;height:${z.h}%;background:${z.c};` +
      `animation-delay:${zi * 90}ms`;
    city.appendChild(plate);

    // Fill the plate with a loose grid of buildings.
    const cols = Math.max(2, Math.round(z.w / 7));
    const rows = Math.max(2, Math.round(z.h / 11));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rnd() < 0.22) continue;               // vacant lot
        const cw = z.w / cols, ch = z.h / rows;
        const pad = 0.18;
        const b = document.createElement('div');
        b.className = 'building' + (rnd() > 0.78 ? ' tall' : '');
        b.style.left   = (z.x + c * cw + cw * pad) + '%';
        b.style.top    = (z.y + r * ch + ch * pad) + '%';
        b.style.width  = (cw * (1 - pad * 2)) + '%';
        b.style.height = (ch * (1 - pad * 2)) + '%';
        b.style.animationPlayState = 'paused';
        city.appendChild(b);
        buildings.push(b);
      }
    }
  });
}

/* ---------- 2. Replay: release buildings one at a time ---- */

const fillEl = document.getElementById('fill');
const metaEl = document.getElementById('meta');
const playEl = document.getElementById('play');

const TOTAL_COMMITS = 6158;
let timer = null;

function replay() {
  clearInterval(timer);
  buildCity();

  let i = 0;
  const step = Math.max(12, Math.round(2600 / Math.max(buildings.length, 1)));

  timer = setInterval(() => {
    if (i >= buildings.length) {
      clearInterval(timer);
      if (metaEl) metaEl.textContent =
        `commit ${TOTAL_COMMITS.toLocaleString()} / ${TOTAL_COMMITS.toLocaleString()}`;
      return;
    }
    // Un-pause this one building — CSS handles the actual rise.
    buildings[i].style.animationPlayState = 'running';
    i++;

    const pct = i / buildings.length;
    if (fillEl) fillEl.style.width = (pct * 100) + '%';
    if (metaEl) {
      const commit = Math.max(1, Math.round(pct * TOTAL_COMMITS));
      metaEl.textContent =
        `commit ${commit.toLocaleString()} / ${TOTAL_COMMITS.toLocaleString()}`;
    }
  }, step);
}

if (playEl) playEl.addEventListener('click', replay);

// Build once up front, then start the replay when it scrolls into view.
buildCity();
if (city) {
  const cityObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { replay(); obs.unobserve(e.target); }
    });
  }, { threshold: 0.25 });
  cityObserver.observe(city);
}

/* ---------- 3. Scroll reveal ------------------------------ */

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (!e.isIntersecting) return;
    // Slight stagger so a row of cards arrives in sequence.
    setTimeout(() => e.target.classList.add('in'), i * 70);
    revealObserver.unobserve(e.target);
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

/* ---------- 4. Stats count up ----------------------------- */

const statObserver = new IntersectionObserver((entries, obs) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    const target = Number(el.dataset.count);
    const started = performance.now();
    const dur = 1100;

    const tick = (now) => {
      const t = Math.min(1, (now - started) / dur);
      const eased = 1 - Math.pow(1 - t, 3);           // easeOutCubic
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    obs.unobserve(el);
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-count]').forEach((el) => statObserver.observe(el));

/* ---------- 5. Nav ---------------------------------------- */

const nav = document.getElementById('nav');
const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const toggle = document.querySelector('.nav-toggle');
const links = document.querySelector('.nav-links');
if (toggle && links) {
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ---------- 6. Repo form ---------------------------------- */
/* Hands the repo off to the running CodeCity app. The app lives on
   :3000; if it isn't running the user gets told rather than being
   dropped on a dead link. */

const APP_ORIGIN = 'http://localhost:3000';
const form = document.getElementById('repo-form');
const input = document.getElementById('repo-input');
const hint = document.getElementById('hint');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = (input.value || input.placeholder).trim();
    if (!raw) return;

    const repo = raw.startsWith('http') ? raw : 'https://' + raw;
    hint.classList.remove('err');
    hint.textContent = 'Opening the builder…';

    try {
      const res = await fetch(APP_ORIGIN + '/api/health', { mode: 'cors' });
      if (!res.ok) throw new Error('unhealthy');
      window.open(APP_ORIGIN + '/?repo=' + encodeURIComponent(repo), '_blank', 'noopener');
      hint.textContent = 'Builder opened in a new tab.';
    } catch {
      hint.classList.add('err');
      hint.innerHTML =
        'The builder isn’t running. Start it with <code>npm start</code> in <code>backend/</code> ' +
        'and <code>npm run dev</code> in <code>frontend/</code>.';
    }
  });
}
