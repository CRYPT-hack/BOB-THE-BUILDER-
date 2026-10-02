// Talks to the Express backend: kick off analysis, poll the job, get the city.

export async function analyzeRepo(repo, onProgress) {
  let res;
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo }),
    });
  } catch {
    throw new Error(OFFLINE);
  }
  if (!res.ok) throw new Error(await errMsg(res));
  const { jobId, city } = await res.json();
  if (city) return city;          // backend answered from cache synchronously
  return pollJob(jobId, onProgress);
}

async function pollJob(jobId, onProgress) {
  for (;;) {
    await sleep(700);
    let res;
    try {
      res = await fetch(`/api/job/${jobId}`);
    } catch {
      throw new Error(OFFLINE);
    }
    if (!res.ok) throw new Error(await errMsg(res));
    const job = await res.json();
    if (job.status === 'done') return job.city;
    if (job.status === 'error') throw new Error(job.error || 'Analysis failed');
    if (onProgress) onProgress(job);
  }
}

/** Load a pre-generated city file (used for the default demo on first load). */
export async function loadStaticCity(url = '/city.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url}`);
  return res.json();
}

const OFFLINE =
  'Can’t reach the analysis server. Start it with:  npm start  (in backend/)';

/**
 * Turn a failed response into something actionable. A bare "HTTP 500" is
 * usually the dev proxy reporting that nothing is listening on the API port —
 * saying so beats making the user guess whether their repo was the problem.
 */
async function errMsg(res) {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body);
    if (parsed.error) return parsed.error;
  } catch {
    // Not JSON: the proxy failed before the API ever saw the request.
    if (res.status >= 500) return OFFLINE;
  }
  return `HTTP ${res.status}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
