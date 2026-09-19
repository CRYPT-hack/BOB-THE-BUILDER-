// The heart of the project.
//
// Instead of reading files off disk (like the reference repo, which can only
// ever see the CURRENT state), we replay the entire commit history in ONE pass:
//
//   git log --reverse --no-renames --numstat --pretty=format:@@C@@%H\x1f%at\x1f%an
//
// --numstat prints "added<TAB>deleted<TAB>path" per file per commit. Folding
// added-deleted cumulatively reconstructs every file's line count at every
// commit, so we can grow the city over time without ever checking out a commit.
//
// The output is parsed as it streams: a large repo emits hundreds of megabytes
// of numstat text, so we never hold the whole log in memory.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { getLanguageFromPath } from './languages.js';

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', '.next', 'out',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'vendor',
  '.cargo', 'deps', '_build', 'coverage', '.gradle', 'bin', 'obj',
]);

// Generated / lock files: huge line counts, zero authored signal. They'd
// create skyscrapers that dwarf the real code, so we leave them out.
const IGNORED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'cargo.lock', 'poetry.lock', 'gemfile.lock', 'composer.lock',
  'go.sum', 'flake.lock', 'podfile.lock',
]);

function isIgnored(path) {
  if (path.split('/').some((part) => IGNORED_DIRS.has(part))) return true;
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (IGNORED_FILES.has(base)) return true;
  if (/\.min\.(js|css)$/.test(base)) return true; // minified bundles
  return false;
}

/**
 * Run `git log` over a local repo and return { commits, files }.
 *   commits: [{ sha, ts, author }]                (oldest first)
 *   files:   [{ path, lang, history, maxLoc, birth, death }]
 *     history: [{ c, loc }]  loc = lines of code AFTER commit index c
 */
export function analyzeRepo(repoPath, opts = {}) {
  const onProgress = opts.onProgress;

  return new Promise((resolve, reject) => {
    const args = [
      '-c', 'core.quotePath=false',
      'log', '--reverse', '--no-renames', '--numstat',
      // %s is the subject line, so the timeline can say what a commit did
      // rather than only who made it and when.
      '--pretty=format:@@C@@%H\x1f%at\x1f%an\x1f%s',
    ];
    const git = spawn('git', args, { cwd: repoPath, windowsHide: true });

    const commits = [];
    const files = new Map();
    let ci = -1;
    let stderr = '';

    git.stderr.on('data', (d) => {
      // Keep only the tail; git can be chatty on large repos.
      stderr = (stderr + d).slice(-4000);
    });

    const rl = readline.createInterface({ input: git.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (line.startsWith('@@C@@')) {
        const [sha, ts, author, ...rest] = line.slice(5).split('\x1f');
        commits.push({
          sha,
          ts: Number(ts) || 0,
          author: author || 'unknown',
          subject: rest.join('\x1f'),
        });
        ci = commits.length - 1;
        if (onProgress && ci % 5000 === 0 && ci > 0) onProgress(ci);
        return;
      }
      if (!line) return;

      // numstat line: added \t deleted \t path
      const tab = line.split('\t');
      if (tab.length < 3) return;
      const addStr = tab[0];
      if (addStr !== '-' && !/^\d+$/.test(addStr)) return; // not a numstat line
      const path = tab.slice(2).join('\t');
      if (isIgnored(path)) return;

      const added = addStr === '-' ? 0 : parseInt(addStr, 10);
      const deleted = tab[1] === '-' ? 0 : parseInt(tab[1], 10);

      let f = files.get(path);
      if (!f) {
        f = {
          path, lang: getLanguageFromPath(path), history: [],
          _loc: 0, _prev: null, maxLoc: 0, birth: ci, death: null,
          _first: ci, _last: ci, touches: 0, _authors: new Map(),
        };
        files.set(path, f);
      }
      // Every numstat line is one commit touching this file, and the commit's
      // author is already known — so per-file authorship falls out of the same
      // pass for free, with no `git blame`.
      f.touches++;
      f._last = ci;
      const who = commits[ci].author;
      f._authors.set(who, (f._authors.get(who) || 0) + 1);

      f._loc = Math.max(0, f._loc + added - deleted);
      if (f._loc > f.maxLoc) f.maxLoc = f._loc;
      // Compress inline: only record points where the line count actually moved.
      if (f._prev === null || f._loc !== f._prev) {
        f.history.push({ c: ci, loc: f._loc });
        f._prev = f._loc;
      }
    });

    git.on('error', (e) => reject(new Error(`Failed to run git: ${e.message}`)));

    let closed = false;
    const finish = (code) => {
      if (closed) return;
      closed = true;
      if (code !== 0) return reject(new Error(`git log exited ${code}: ${stderr.trim()}`));

      for (const f of files.values()) {
        f.birth = f.history.length ? f.history[0].c : 0;
        if (f._loc === 0 && f.history.length) f.death = f.history[f.history.length - 1].c;

        // The person who touched the file most is its de facto maintainer.
        let top = null, topN = 0;
        for (const [who, n] of f._authors) if (n > topN) { top = who; topN = n; }
        f.topAuthor = top;
        f.topAuthorShare = f.touches ? topN / f.touches : 0;
        f.contributors = f._authors.size;
        f.creator = commits[f._first] ? commits[f._first].author : null;
        // Timestamps, not commit indices: buildCity may resample the timeline
        // onto fewer frames, and an index would then point at the wrong step.
        f.createdAt = commits[f._first] ? commits[f._first].ts : 0;
        f.lastTouchedAt = commits[f._last] ? commits[f._last].ts : 0;

        delete f._loc;
        delete f._prev;
        delete f._authors;
        delete f._first;
        delete f._last;
      }
      resolve({ commits, files: [...files.values()] });
    };

    // Wait for BOTH the stream to drain and the process to exit.
    let ended = false, exited = null;
    rl.on('close', () => { ended = true; if (exited !== null) finish(exited); });
    git.on('close', (code) => { exited = code; if (ended) finish(code); });
  });
}
