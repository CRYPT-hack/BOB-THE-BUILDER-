// Language detection + color mapping.
// Ported from grahambrooks/codecity (backend/src/models.rs) and extended.

const EXT_TO_LANG = {
  rs: 'Rust',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript', tsx: 'TypeScript',
  py: 'Python', pyw: 'Python',
  go: 'Go',
  java: 'Java',
  cpp: 'C++', cc: 'C++', cxx: 'C++', 'c++': 'C++', hpp: 'C++', hxx: 'C++', hh: 'C++',
  c: 'C', h: 'C',
  rb: 'Ruby',
  html: 'HTML', htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS', sass: 'Sass',
  json: 'JSON',
  yaml: 'YAML', yml: 'YAML',
  md: 'Markdown', markdown: 'Markdown',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  php: 'PHP',
  swift: 'Swift',
  kt: 'Kotlin', kts: 'Kotlin',
  scala: 'Scala', sc: 'Scala',
  hs: 'Haskell', lhs: 'Haskell',
  ex: 'Elixir', exs: 'Elixir',
  clj: 'Clojure', cljs: 'Clojure', cljc: 'Clojure',
  lua: 'Lua',
  r: 'R',
  dart: 'Dart',
  vue: 'Vue',
  svelte: 'Svelte',
  sql: 'SQL',
  graphql: 'GraphQL', gql: 'GraphQL',
  toml: 'TOML',
  xml: 'XML',
};

// GitHub-style language colors.
const LANG_COLOR = {
  Rust: '#DEA584',
  JavaScript: '#F7DF1E',
  TypeScript: '#3178C6',
  Python: '#3776AB',
  Go: '#00ADD8',
  Java: '#B07219',
  'C++': '#F34B7D',
  C: '#555555',
  Ruby: '#CC342D',
  HTML: '#E34C26',
  CSS: '#563D7C',
  SCSS: '#C6538C',
  Sass: '#C6538C',
  JSON: '#8892BF',
  YAML: '#CB171E',
  Markdown: '#083FA1',
  Shell: '#89E051',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Scala: '#DC322F',
  Haskell: '#5E5086',
  Elixir: '#6E4A7E',
  Clojure: '#DB5855',
  Lua: '#000080',
  R: '#198CE7',
  Dart: '#00B4AB',
  Vue: '#41B883',
  Svelte: '#FF3E00',
  SQL: '#E38C00',
  GraphQL: '#E10098',
  TOML: '#9C4221',
  XML: '#0060AC',
  Other: '#8B8B8B',
};

/** Extract the lowercase extension from a repo-relative path. */
export function extOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return ''; // no ext, or dotfile like ".gitignore"
  return base.slice(dot + 1).toLowerCase();
}

/** Map a repo-relative path to a language name (falls back to "Other"). */
export function getLanguageFromPath(path) {
  return EXT_TO_LANG[extOf(path)] || 'Other';
}

/** Map a language name to a hex color. */
export function getLanguageColor(lang) {
  return LANG_COLOR[lang] || LANG_COLOR.Other;
}

/**
 * Colour for a building. Recognised languages keep their canonical colour;
 * everything else (Dockerfiles, .bazelrc, LICENSE, …) gets a muted hue derived
 * from its extension, so unknown files stay visually grouped by kind instead
 * of flooding the city with one flat grey.
 */
export function getColorForPath(path, lang) {
  if (lang !== 'Other') return getLanguageColor(lang);

  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const ext = extOf(path) || base; // extensionless files key on their name
  let h = 2166136261;
  for (let i = 0; i < ext.length; i++) {
    h ^= ext.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (h >>> 0) / 4294967295;
  // Enough saturation to tell one kind of config file from another, well
  // short of the saturation the real languages get.
  return hslToHex(n, 0.32, 0.52 + ((h >>> 8) % 100) / 1000);
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v);
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
