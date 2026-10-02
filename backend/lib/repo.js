// Parse whatever the user typed into a clone URL (or local path), and clone.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const exec = promisify(execFile);

/**
 * Accepts:
 *   owner/repo
 *   https://github.com/owner/repo(.git)
 *   https://gitlab.com/owner/repo, etc.
 *   an absolute local path to a git repo
 * Returns { kind, url|path, key, name }.
 */
export function parseRepoInput(input) {
  const s = String(input || '').trim();
  if (!s) throw new Error('Enter a repository');

  // Local path to a git repo
  if (fs.existsSync(s) && fs.existsSync(path.join(s, '.git'))) {
    const abs = path.resolve(s);
    return { kind: 'local', path: abs, key: `local:${abs}`.toLowerCase(), name: path.basename(abs) };
  }

  // Full http(s) URL
  let m = s.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (m) {
    const [, host, owner, repo] = m;
    return {
      kind: 'url',
      url: `https://${host}/${owner}/${repo}.git`,
      key: `${host}/${owner}/${repo}`.toLowerCase(),
      name: `${owner}/${repo}`,
    };
  }

  // owner/repo shorthand -> GitHub
  m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (m) {
    const [, owner, repo] = m;
    return {
      kind: 'url',
      url: `https://github.com/${owner}/${repo}.git`,
      key: `github.com/${owner}/${repo}`.toLowerCase(),
      name: `${owner}/${repo}`,
    };
  }

  throw new Error('Use owner/repo or a full https git URL');
}

/**
 * Full clone WITHOUT a working tree (--no-checkout): we only need commit
 * history + numstat, never the file contents, so this is fast and small.
 */
export async function cloneRepo(url) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codecity-'));
  await exec('git', ['clone', '--no-checkout', '--quiet', url, dir], {
    maxBuffer: 1024 * 1024 * 64,
    timeout: 180000,
  });
  return dir;
}

export async function headSha(repoPath) {
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
    return stdout.trim();
  } catch {
    return null;
  }
}
