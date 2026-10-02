// Explore Files: the repository as a list rather than a skyline — the areas
// that hold the code, a folder tree, one file's profile, and the language mix.
// Everything is measured at the latest commit.

import { el, icon, fileUrl } from '../ui.js';
import {
  packages, languages, tree, contributors, fileProfile, last, fmt, compact, date,
} from '../insights.js';

/**
 * @param root  the <section> to fill
 * @param ctx   { data, showInCity(building) }
 */
export function renderFiles(root, ctx) {
  const { data } = ctx;
  const L = last(data);
  const t = tree(data);
  const pkgs = packages(data);
  const langs = languages(data);
  const people = contributors(data);

  // ---- Hero ----
  const first = data.commits[0], head = data.commits[L];
  const repoLink = data.webUrl
    ? el('a', { href: data.webUrl, target: '_blank', rel: 'noopener' }, data.repo)
    : data.repo;
  const hero = el('div', { class: 'hero' },
    el('div', { class: 'hero-top' },
      el('div', {},
        el('span', { class: 'badge' }, icon('check_circle'), 'Analysis complete'),
        el('h1', {}, 'Repository breakdown'),
        el('p', { class: 'lede' },
          'Every file standing in ', repoLink, ' at its latest commit, grouped by where it lives. ',
          `The history runs from ${date(first?.ts)} to ${date(head?.ts)} on `,
          el('span', { class: 'mono' }, data.branch || 'HEAD'), '.'),
      ),
      el('div', { class: 'hero-actions' },
        el('button', { class: 'btn secondary', onclick: () => exportJson(data) }, icon('download'), 'Export city JSON'),
        el('button', { class: 'btn primary', onclick: () => ctx.showInCity(null) }, icon('apartment'), 'Open city view'),
      ),
    ),
    el('div', { class: 'stat-row' },
      stat('Files standing', fmt(t.count)),
      stat('Lines of code', compact(t.loc), 'accent'),
      stat(data.sampled ? 'Commits (sampled)' : 'Commits', fmt(data.commitCount || data.commits.length)),
      stat('Contributors', fmt(people.length), 'good'),
    ),
  );

  // ---- Packages ----
  const pkgSection = el('section', {},
    sectionHead('inventory_2', 'Where the code lives',
      'The largest areas of the repo by lines of code. Click one to see it in the tree.',
      `${fmt(pkgs.length)} areas`),
    el('div', { class: 'grid-4' }, ...pkgs.map((p) => el('div', {
      class: 'card clickable',
      onclick: () => { explorer.open(p.name); explorer.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    },
      el('div', { class: 'pkg-head' },
        el('div', { class: 'pkg-icon', style: { color: p.color } }, icon(p.name === '(root files)' ? 'description' : 'folder')),
        el('div', { style: { minWidth: 0 } },
          el('h3', {}, p.name),
          el('div', { class: 'sub' }, `Mostly ${p.lang}`)),
        el('span', { class: 'size', style: { color: p.color, borderColor: p.color + '55' } }, `${compact(p.loc)} loc`),
      ),
      el('p', { class: 'pkg-desc' },
        `${fmt(p.files)} file${p.files === 1 ? '' : 's'}, ${Math.round(p.share * 100)}% of the codebase.`,
        p.owner ? ` Changed most by ${p.owner}.` : ''),
      el('div', { class: 'pkg-bar' }, el('span', { style: { width: `${Math.max(2, p.share * 100)}%`, background: p.color } })),
      el('div', { class: 'modules' },
        el('div', { class: 'label' }, 'Largest files'),
        el('div', { class: 'list' }, ...p.modules.map((m) => el('button', {
          class: 'module-chip', title: m.path,
          onclick: (e) => { e.stopPropagation(); explorer.select(m.path); explorer.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        }, m.name))),
      ),
    ))),
  );

  // ---- Explorer ----
  const explorer = makeExplorer(data, t, ctx);
  const explorerSection = el('section', {},
    sectionHead('account_tree', 'File explorer', 'Folders are ordered by size. Pick a file to see its story.'),
    explorer.el,
  );

  // ---- Languages ----
  const langSection = el('section', {},
    sectionHead('code', 'Language composition', 'Share of lines of code at the latest commit.', `${fmt(langs.length)} languages`),
    el('div', { class: 'card' },
      el('div', { class: 'lang-bar' }, ...langs.map((l) => el('span', {
        title: `${l.lang} · ${Math.round(l.share * 100)}%`,
        style: { width: `${l.share * 100}%`, background: l.color },
      }))),
      el('div', { class: 'grid-4' }, ...langs.slice(0, 8).map((l) => el('div', { class: 'lang-card' },
        el('div', { class: 'top' }, el('i', { style: { background: l.color } }), l.lang,
          el('span', { class: 'pct' }, `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`)),
        el('div', { class: 'big' }, compact(l.loc), ' ', el('small', {}, 'lines')),
        el('div', { class: 'foot' }, `${fmt(l.files)} file${l.files === 1 ? '' : 's'}`),
      ))),
    ),
  );

  root.replaceChildren(el('div', { class: 'page-inner' }, hero, pkgSection, explorerSection, langSection));

  // Start with the biggest file open so the profile is never empty.
  const biggest = data.buildings
    .filter((b) => b.history.at(-1)?.loc > 0)
    .sort((a, b) => b.maxLoc - a.maxLoc)[0];
  if (biggest) explorer.select(biggest.path, false);
}

function stat(label, value, cls = '') {
  return el('div', { class: 'stat' }, el('div', { class: 'label' }, label), el('div', { class: `value ${cls}` }, value));
}

export function sectionHead(ic, title, sub, aside) {
  return el('div', { class: 'section-head' },
    el('div', {}, el('h2', {}, icon(ic), title), sub ? el('p', {}, sub) : null),
    aside ? el('span', { class: 'aside' }, aside) : null);
}

function exportJson(data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${(data.repo || 'city').replace(/[^\w.-]+/g, '_')}.city.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Tree + profile ---------------------------------------------------

function makeExplorer(data, root, ctx) {
  const open = new Set(); // folder paths currently expanded
  let selected = null;

  const treeBox = el('div', { class: 'tree' });
  const profile = el('div', { class: 'card profile-card' });
  const node = el('div', { class: 'explorer' },
    el('div', { class: 'card tree-card' },
      el('div', { class: 'tree-head' },
        el('span', {}, icon('folder_open'), data.repo),
        el('span', { class: 'mono' }, `${fmt(root.count)} files`)),
      treeBox),
    profile,
  );

  const draw = () => {
    const rows = [];
    const walk = (n, depth) => {
      const folders = [...n.folders.values()].sort((a, b) => b.loc - a.loc);
      for (const f of folders) {
        const isOpen = open.has(f.path);
        rows.push(el('button', {
          class: `tree-row${isOpen ? ' open' : ''}`,
          style: { paddingLeft: `${8 + depth * 16}px` },
          onclick: () => { isOpen ? open.delete(f.path) : open.add(f.path); draw(); },
        }, icon('chevron_right', 'caret'), icon(isOpen ? 'folder_open' : 'folder'),
           el('span', { class: 'name' }, f.name), el('span', { class: 'n' }, `${f.count} · ${compact(f.loc)}`)));
        if (isOpen) walk(f, depth + 1);
      }
      for (const file of [...n.files].sort((a, b) => b.loc - a.loc)) {
        rows.push(el('button', {
          class: `tree-row${selected === file.b.path ? ' on' : ''}`,
          style: { paddingLeft: `${8 + depth * 16 + 22}px` },
          onclick: () => api.select(file.b.path),
        }, el('i', { style: { background: file.b.color } }),
           el('span', { class: 'name' }, file.name), el('span', { class: 'n' }, compact(file.loc))));
      }
    };
    walk(root, 0);
    treeBox.replaceChildren(...rows);
  };

  const showProfile = (b) => {
    const p = fileProfile(data, b, last(data));
    const url = fileUrl(data, b.path);
    profile.replaceChildren(
      el('div', { class: 'profile-top' },
        el('div', { style: { minWidth: 0 } },
          el('span', { class: 'badge violet' }, icon('description'), b.lang),
          el('h3', {}, b.path.split('/').pop()),
          el('div', { class: 'path' }, b.path)),
      ),
      el('div', { class: 'metric-row' },
        metric('Lines now', p.loc ? fmt(p.loc) : 'Deleted', `Top ${p.topPct}% by size`),
        metric('Peak size', fmt(b.maxLoc), 'lines'),
        metric('Commits', p.touches != null ? fmt(p.touches) : '—',
          p.contributors ? `${p.contributors} contributor${p.contributors === 1 ? '' : 's'}` : ''),
      ),
      el('p', { class: 'pkg-desc' }, p.story),
      el('div', { class: 'kv' },
        kv('Lead maintainer', p.maintainer || 'Unknown'),
        kv('Created', b.creator ? `${date(b.createdAt)} by ${b.creator}` : '—'),
        kv('Last changed', p.lastTouched || '—'),
      ),
      el('div', { class: 'hero-actions', style: { marginTop: '18px' } },
        el('button', { class: 'btn primary', onclick: () => ctx.showInCity(b) }, icon('location_on'), 'Show in city'),
        url ? el('a', { class: 'btn secondary', href: url, target: '_blank', rel: 'noopener' }, icon('open_in_new'), 'View source') : null,
      ),
    );
  };

  const api = {
    el: node,
    open(path) {
      // Expand the folder and all of its parents.
      const segs = path.split('/');
      for (let i = 1; i <= segs.length; i++) open.add(segs.slice(0, i).join('/'));
      draw();
    },
    select(path, expand = true) {
      const b = data.buildings.find((x) => x.path === path);
      if (!b) return;
      selected = path;
      const dir = path.split('/').slice(0, -1).join('/');
      if (dir && expand !== false) api.open(dir);
      else if (dir) { const segs = dir.split('/'); for (let i = 1; i <= segs.length; i++) open.add(segs.slice(0, i).join('/')); draw(); }
      else draw();
      showProfile(b);
    },
  };

  if (!root.folders.size && !root.files.length) {
    profile.replaceChildren(el('div', { class: 'empty-state' }, icon('folder_off'), 'No files at the latest commit.'));
  }
  draw();
  return api;
}

function metric(label, value, sub) {
  return el('div', { class: 'metric' },
    el('span', { class: 'label' }, label),
    el('span', { class: 'value mono' }, value),
    el('span', { class: 'sub' }, sub || ''));
}

const kv = (k, v) => el('div', {}, el('span', {}, k), el('span', {}, v));
