// History & Evolution: the same playhead as the city, laid out as a story —
// four eras, a growth curve, and a few facts pulled from the log. Scrubbing
// here moves the city too; there is only one timeline.

import { el, icon } from '../ui.js';
import { sectionHead } from './files.js';
import { series, eras, contributors, health, last, fmt, compact, date, year } from '../insights.js';

const DAY = 86400;

/**
 * @param root  the <section> to fill
 * @param ctx   { data, timeline }
 * @returns     update(commitIndex, playing) — call when the playhead moves
 */
export function renderHistory(root, ctx) {
  const { data, timeline } = ctx;
  const L = last(data);
  const s = series(data);
  const es = eras(data);
  const people = contributors(data);
  const h = health(data);
  const c0 = data.commits[0], cN = data.commits[L];

  // ---- Hero ----
  const span = spanText((cN?.ts || 0) - (c0?.ts || 0));
  const hero = el('div', { class: 'hero' },
    el('div', { class: 'hero-top' },
      el('div', {},
        el('span', { class: 'badge violet' }, icon('history'), 'Evolution'),
        el('h1', {}, 'How ', data.repo, ' was built'),
        el('p', { class: 'lede' },
          `${fmt(data.commitCount || data.commits.length)} commits from ${date(c0?.ts)} to ${date(cN?.ts)}, `
          + 'split into four eras of equal length. The playhead here is the same one that drives the city.'),
      ),
      el('div', { class: 'chip-stats' },
        chip('Timespan', span),
        chip('Lines today', compact(s.loc[L] || 0), 'good'),
        chip('Contributors', fmt(people.length)),
      ),
    ),
  );

  // ---- Transport ----
  const playIcon = icon('play_arrow');
  const playBtn = el('button', { class: 'play', title: 'Play / pause', onclick: () => timeline.toggle() }, playIcon);
  const when = el('b', {}, '—');
  const whenSub = el('span', {}, '—');
  const range = el('input', { type: 'range', min: '0', max: String(L), step: '1', value: '0', 'aria-label': 'Timeline', style: { flex: '1' } });
  range.addEventListener('input', () => timeline.seek(Number(range.value)));
  const eraName = el('b', {}, '—');
  const transport = el('div', { class: 'transport' },
    playBtn,
    el('div', { class: 'when' }, when, whenSub),
    el('span', { class: 'mono dim' }, year(c0?.ts)),
    range,
    el('span', { class: 'mono dim' }, 'Present'),
    el('div', { class: 'anchor' }, 'Current era', eraName),
  );

  // ---- Eras ----
  const eraCards = es.map((e) => el('div', {
    class: 'card era clickable',
    onclick: () => timeline.seek(e.to),
    title: 'Jump to the end of this era',
  },
    el('div', { class: 'era-top' },
      el('span', { class: 'when' }, `${year(e.start)}${year(e.end) !== year(e.start) ? `–${year(e.end)}` : ''}`),
      icon(['flag', 'construction', 'trending_up', 'apartment'][e.index] || 'flag')),
    el('h3', { title: e.title }, e.title),
    el('p', {},
      `Era ${e.index + 1}: ${fmt(e.commits)} commits`,
      e.lead ? `, led by ${e.lead}` : '',
      `. The largest change landed on ${date(data.commits[e.headline].ts)}.`),
    el('div', { class: 'foot' },
      el('span', {}, icon('description'), `${fmt(e.files)} files`),
      el('span', { class: e.dLoc > 0 ? 'up' : '' }, `${e.dLoc >= 0 ? '+' : ''}${compact(e.dLoc)} lines`)),
  ));
  const eraSection = el('section', {},
    sectionHead('timeline', 'Eras', 'Click an era to move the city to where it ended.'),
    el('div', { class: 'grid-4' }, ...eraCards));

  // ---- Chart ----
  let metric = 'loc';
  const tabs = el('div', { class: 'chart-tabs' },
    ...[['loc', 'Total lines'], ['files', 'File count']].map(([k, label]) => el('button', {
      class: k === metric ? 'active' : '', dataset: { k },
      onclick: (ev) => {
        metric = k;
        for (const b of tabs.children) b.classList.toggle('active', b.dataset.k === k);
        drawChart();
      },
    }, label)));
  const chart = el('div', { class: 'chart' });
  const axis = el('div', { class: 'chart-axis' });
  const chartCard = el('div', { class: 'card chart-card' },
    el('div', { class: 'chart-head' },
      el('div', {}, el('h2', {}, icon('show_chart'), 'Growth over time'),
        el('p', {}, 'Cumulative size of the city at every commit. Click anywhere to jump there.')),
      tabs),
    chart, axis,
    factRow(data, s, people, h),
  );

  root.replaceChildren(el('div', { class: 'page-inner' }, hero, transport, eraSection, chartCard));

  // ---- Chart drawing ----
  const PAD = { l: 16, r: 16, t: 36, b: 16 };
  let geom = null;
  let current = timeline.commit < 0 ? 0 : timeline.commit;
  let hoverIdx = null;

  function drawChart() {
    const W = chart.clientWidth, H = chart.clientHeight;
    if (!W || !H) return;
    const vals = metric === 'loc' ? s.loc : s.files;
    let max = 0;
    for (const v of vals) if (v > max) max = v;
    max = max || 1;
    const x = (i) => PAD.l + (L ? i / L : 1) * (W - PAD.l - PAD.r);
    const y = (v) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
    geom = { x, y, vals, W };

    // Downsample to about one point per pixel.
    const step = Math.max(1, Math.floor(vals.length / W));
    let d = '';
    for (let i = 0; i <= L; i += step) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`;
    d += `L${x(L).toFixed(1)},${y(vals[L]).toFixed(1)}`;
    const area = `${d}L${x(L).toFixed(1)},${H - PAD.b}L${x(0).toFixed(1)},${H - PAD.b}Z`;

    const NS = 'http://www.w3.org/2000/svg';
    const sv = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const defs = sv('defs', {});
    const grad = sv('linearGradient', { id: 'areaFill', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(sv('stop', { offset: '0%', 'stop-color': '#a78bfa', 'stop-opacity': '0.28' }),
      sv('stop', { offset: '100%', 'stop-color': '#a78bfa', 'stop-opacity': '0' }));
    defs.append(grad);
    svg.append(defs);
    for (let g = 0; g <= 4; g++) {
      const gy = PAD.t + (g / 4) * (H - PAD.t - PAD.b);
      svg.append(sv('line', { class: 'grid-line', x1: 0, x2: W, y1: gy, y2: gy }));
    }
    svg.append(sv('path', { class: 'area', d: area }), sv('path', { class: 'curve', d }));
    const now = sv('line', { class: 'now-line', y1: PAD.t - 12, y2: H - PAD.b });
    svg.append(now);
    for (const e of es) {
      svg.append(sv('circle', { class: 'era-dot', cx: x(e.to), cy: y(vals[e.to]), r: 5 }));
    }
    geom.now = now;

    const callout = el('div', { class: 'chart-callout' });
    const hover = el('div', { class: 'chart-hover' });
    hover.addEventListener('mousemove', (ev) => { hoverIdx = idxAt(ev); placeCallout(); });
    hover.addEventListener('mouseleave', () => { hoverIdx = null; placeCallout(); });
    hover.addEventListener('click', (ev) => timeline.seek(idxAt(ev)));
    geom.callout = callout;
    chart.replaceChildren(svg, callout, hover);

    const ticks = 5;
    axis.replaceChildren(...Array.from({ length: ticks }, (_, k) =>
      el('span', {}, date(data.commits[Math.round((k / (ticks - 1)) * L)]?.ts, { year: 'numeric', month: 'short' }))));
    placeNow();
  }

  function idxAt(ev) {
    const r = chart.getBoundingClientRect();
    const f = (ev.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r);
    return Math.max(0, Math.min(L, Math.round(f * L)));
  }

  function placeNow() {
    if (!geom) return;
    const nx = geom.x(current).toFixed(1);
    geom.now.setAttribute('x1', nx);
    geom.now.setAttribute('x2', nx);
    placeCallout();
  }

  function placeCallout() {
    if (!geom) return;
    const i = hoverIdx ?? current;
    const v = geom.vals[i];
    const unit = metric === 'loc' ? 'lines' : 'files';
    geom.callout.replaceChildren(el('i'), `${fmt(v)} ${unit}`, el('small', {}, date(data.commits[i]?.ts)));
    geom.callout.style.left = `${Math.min(Math.max(geom.x(i), 90), geom.W - 90)}px`;
    geom.callout.style.top = `${geom.y(v)}px`;
  }

  const ro = new ResizeObserver(() => drawChart());
  ro.observe(chart);

  function update(idx, playing) {
    current = Math.max(0, idx);
    const c = data.commits[current];
    playIcon.textContent = playing ? 'pause' : 'play_arrow';
    range.value = String(current);
    range.style.setProperty('--pct', `${L ? (current / L) * 100 : 100}%`);
    when.textContent = date(c?.ts);
    whenSub.textContent = `commit ${fmt(current + 1)} of ${fmt(data.commits.length)}`;
    const cur = es.find((e) => current >= e.from && current <= e.to);
    eraName.textContent = cur ? `Era ${cur.index + 1} · ${cur.title}` : '—';
    eraCards.forEach((card, i) => card.classList.toggle('current', es[i] === cur));
    placeNow();
  }
  update(current, timeline.playing);

  return { update, dispose: () => ro.disconnect() };
}

function chip(label, value, cls = '') {
  return el('div', { class: 'chip-stat' }, el('div', { class: 'label' }, label), el('div', { class: `value ${cls}` }, value));
}

function spanText(sec) {
  const days = Math.max(1, Math.round(sec / DAY));
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  const months = Math.round(days / 30.4);
  if (months < 24) return `${months} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

function factRow(data, s, people, h) {
  let big = 0;
  for (let i = 1; i < s.dLoc.length; i++) if (s.dLoc[i] > s.dLoc[big]) big = i;
  const bc = data.commits[big];
  const top = people[0];
  const fact = (ic, color, t, v, title) => el('div', { class: 'fact' },
    el('div', { class: 'ic', style: { background: `${color}1a`, color } }, icon(ic)),
    el('div', {}, el('div', { class: 't' }, t), el('div', { class: 'v', title: title || v }, v)));
  return el('div', { class: 'fact-row' },
    fact('bolt', '#a78bfa', `Largest commit · +${compact(s.dLoc[big])} lines`, bc?.subject || bc?.sha || '—'),
    fact('person', '#34d399', 'Most commits',
      top ? `${top.name} · ${fmt(top.commits)} (${Math.round((top.commits / data.commits.length) * 100)}%)` : '—'),
    fact('delete_sweep', '#f59e0b', 'Files demolished along the way',
      `${fmt(h.demolished)} of ${fmt(h.demolished + h.live)} ever built`),
  );
}
