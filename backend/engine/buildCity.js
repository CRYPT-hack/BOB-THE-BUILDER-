// Orchestrator: git history -> stable layout -> City Timeline JSON.
// This JSON is the single contract between the backend and the Three.js frontend.

import path from 'node:path';
import { analyzeRepo } from './analyze.js';
import { layoutTreemap } from './layout.js';
import { getColorForPath } from './languages.js';

// The timeline is the repo's real commit history — one frame per commit — and
// that is what you get for any repo you are realistically going to point this
// at. This constant is only a backstop against pathological histories (think
// the Linux kernel at a million commits), where the payload would stop being
// something a browser should download. Sampling below it crushes the early
// history, where most repos create the bulk of their files, so the city snaps
// into existence in the first few frames and then sits still.
const MAX_FRAMES = 12000;

/**
 * @param {string} repoPath  local path to a git repo
 * @param {object} [opts]    { size, maxFrames, onProgress }
 * @returns City Timeline JSON
 */
export async function buildCity(repoPath, opts = {}) {
  const size = opts.size ?? 120;
  const maxFrames = opts.maxFrames ?? MAX_FRAMES;

  const { commits, files } = await analyzeRepo(repoPath, { onProgress: opts.onProgress });

  // Downsample the timeline if the history is long.
  const frames = pickFrames(commits.length, maxFrames);

  // Only files that ever held real code — and that are still visible on the
  // sampled grid — get a building. Resolve this BEFORE laying out the city so
  // dropped files don't leave holes in the treemap.
  const frameCount = frames ? frames.length : commits.length;

  const survivors = [];
  for (const f of files) {
    if (f.maxLoc <= 0) continue;
    const history = frames ? resample(f.history, frames) : f.history;
    if (!history.length) continue; // born and died between two frames

    // Land is allocated by how much of the timeline a file actually occupied,
    // and heavily discounted if it is gone by the end. A repo that deleted
    // most of its files would otherwise spend most of its map on empty lots —
    // and HEAD is the state people look at, so surviving files earn the room.
    const lived = aliveFraction(history, frameCount);
    const aliveAtEnd = history[history.length - 1].loc > 0;
    f.layoutWeight =
      (Math.sqrt(f.maxLoc) + 1) * (0.12 + 0.88 * lived) * (aliveAtEnd ? 1 : 0.3);

    survivors.push({ f, history });
  }

  const { plots, districts: allDistricts } = layoutTreemap(survivors.map((s) => s.f), size);

  // Only zones big enough to read as ground get painted. Deep nesting produces
  // a lot of one-file folders whose plates are a few units across; drawn, they
  // scatter the map with confetti instead of describing its structure.
  const minZoneArea = size * size * 0.0015;
  const districts = allDistricts.filter(
    (d) => d.depth <= 3 && d.w * d.d >= minZoneArea
  );

  const buildings = survivors
    .map(({ f, history }) => {
      const slash = f.path.lastIndexOf('/');
      const alive = history.filter((h) => h.loc > 0);
      return {
        path: f.path,
        district: slash >= 0 ? f.path.slice(0, slash) : '(root)',
        lang: f.lang,
        color: getColorForPath(f.path, f.lang),
        plot: plots[f.path],
        birth: alive.length ? alive[0].c : 0,
        death: history.length && history[history.length - 1].loc === 0
          ? history[history.length - 1].c
          : null,
        maxLoc: f.maxLoc,
        history,
      };
    })
    .filter((b) => b.plot);

  const timeline = frames ? frames.map((i) => commits[i]) : commits;

  return {
    repo: path.basename(path.resolve(repoPath)),
    commitCount: commits.length,            // true number of commits
    frameCount: timeline.length,            // steps on the scrubber
    sampled: Boolean(frames),
    // Trim SHAs; keep timestamp + author for the timeline HUD.
    commits: timeline.map((c) => ({ sha: c.sha.slice(0, 10), ts: c.ts, author: c.author })),
    districts,
    buildings,
  };
}

/** Fraction of the timeline a file existed (loc > 0). */
function aliveFraction(history, frameCount) {
  if (!frameCount) return 0;
  let alive = 0;
  for (let i = 0; i < history.length; i++) {
    const end = i + 1 < history.length ? history[i + 1].c : frameCount;
    if (history[i].loc > 0) alive += end - history[i].c;
  }
  return alive / frameCount;
}

/** Evenly spaced frame indices across [0, total-1], always including both ends. */
function pickFrames(total, max) {
  if (total <= max) return null;
  const out = [];
  for (let i = 0; i < max; i++) out.push(Math.round((i * (total - 1)) / (max - 1)));
  return [...new Set(out)];
}

/**
 * Re-express a per-commit history on the sampled frame grid. Each frame takes
 * the file's LOC as of that commit, so the curve stays accurate at every frame
 * (and at the final commit) while dropping everything in between.
 */
function resample(history, frames) {
  const out = [];
  let hi = 0;
  let loc = 0;
  let prev = null;
  for (let fi = 0; fi < frames.length; fi++) {
    const c = frames[fi];
    while (hi < history.length && history[hi].c <= c) loc = history[hi++].loc;
    if (prev === null ? loc > 0 : loc !== prev) out.push({ c: fi, loc });
    prev = loc;
  }
  return out;
}
