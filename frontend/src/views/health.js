// Code Health: signals worth acting on, all read from history rather than
// from static analysis — where change piles up, what only one person has
// ever touched, what nobody has touched in a year, and the biggest files.

import { el, icon } from '../ui.js';
import { sectionHead } from './files.js';
import { health, fmt, compact, ago, last } from '../insights.js';

/**
 * @param root  the <section> to fill
 * @param ctx   { data, showInCity(building) }
 */
export function renderHealth(root, ctx) {
  const { data } = ctx;
  const h = health(data);
  const H = data.commits[last(data)]?.ts || 0;

  const hero = el('div', { class: 'hero' },
    el('div', { class: 'hero-top' },
      el('div', {},
        el('span', { class: 'badge' }, icon('monitor_heart'), 'Code health'),
        el('h1', {}, 'Where to look first'),
        el('p', { class: 'lede' },
          'Risk signals drawn from the commit history: files that change constantly, files only one person '
          + 'understands, and files nobody has opened in over a year. Click any row to find it in the city.'),
      ),
    ),
    el('div', { class: 'stat-row' },
      stat('Files standing', fmt(h.live)),
      stat('Demolished', fmt(h.demolished)),
      stat('Single-owner files', h.hasOwnership ? fmt(h.soloCount) : '—', 'accent'),
      stat('Untouched > 1 year', h.hasOwnership ? fmt(h.staleCount) : '—', 'good'),
    ),
  );

  const lists = el('div', { class: 'grid-2' },
    rankCard('local_fire_department', '#f59e0b', 'Hotspots',
      'Changed in the most commits. Constant churn often marks code that is hard to get right.',
      h.churn, (x) => `${fmt(x.b.touches)} commits`, (x) => x.b.touches || 0, ctx, h.hasOwnership),
    rankCard('straighten', '#a78bfa', 'Largest files',
      'The tallest towers. Big files are harder to review and tend to collect unrelated changes.',
      h.largest, (x) => `${compact(x.loc)} lines`, (x) => x.loc, ctx, true),
    rankCard('person_alert', '#ef4444', 'Single points of knowledge',
      'Only one person has ever changed these (with at least 3 commits). Worth a second pair of eyes.',
      h.soloOwned, (x) => x.b.topAuthor || '—', (x) => x.loc, ctx, h.hasOwnership),
    rankCard('hourglass_empty', '#34d399', 'Dormant',
      'Still standing but untouched for over a year before the latest commit.',
      h.stale, (x) => `idle ${ago(x.b.lastTouchedAt, H).replace(/ ago$/, '')}`, (x) => H - x.b.lastTouchedAt, ctx, h.hasOwnership),
  );

  root.replaceChildren(el('div', { class: 'page-inner' },
    hero,
    el('section', {}, sectionHead('insights', 'Signals', 'Top files for each signal at the latest commit.'), lists)));
}

function stat(label, value, cls = '') {
  return el('div', { class: 'stat' }, el('div', { class: 'label' }, label), el('div', { class: `value ${cls}` }, value));
}

function rankCard(ic, color, title, sub, rows, valueOf, weightOf, ctx, available) {
  const max = rows.reduce((m, x) => Math.max(m, weightOf(x)), 0) || 1;
  const body = !available
    ? el('div', { class: 'empty-state' }, icon('database_off'), 'This city was built without ownership data. Rebuild it to see this signal.')
    : !rows.length
      ? el('div', { class: 'empty-state' }, icon('check_circle'), 'Nothing here — good news.')
      : el('div', { class: 'rank-list' }, ...rows.map((x, i) => el('button', {
        class: 'rank-row', title: x.b.path, onclick: () => ctx.showInCity(x.b),
      },
        el('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
        el('span', { class: 'file' },
          el('b', {}, x.b.path.split('/').pop()),
          el('small', {}, x.b.path),
          el('span', { class: 'bar' }, el('span', { style: { width: `${(weightOf(x) / max) * 100}%`, background: color } }))),
        el('span', { class: 'val' }, valueOf(x)),
      )));
  return el('div', { class: 'card' },
    el('div', { class: 'card-title' }, el('span', { class: 'ms', style: { color } }, ic), title),
    el('div', { class: 'card-sub' }, sub),
    body);
}
