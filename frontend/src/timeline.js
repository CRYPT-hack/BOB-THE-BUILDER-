// Drives the commit playhead: play/pause, scrub, and speed. On every frame it
// advances a floating playhead while playing, and whenever the integer commit
// index changes it tells the City to grow/shrink toward that commit's state.

// Roughly how long a full playthrough should take at 1x, whatever the repo.
const PLAYTHROUGH_SECONDS = 100;
// Floor so a tiny repo doesn't crawl one commit every two seconds.
const MIN_COMMITS_PER_SEC = 1.5;

export class Timeline {
  constructor(city, scene, data) {
    this.city = city;
    this.data = data;
    this.commits = data.commits;
    this.last = Math.max(0, this.commits.length - 1);

    this.playhead = 0;
    this.commit = -1;
    this.playing = false;
    // Speed is a MULTIPLIER, not a commit rate. The timeline is one frame per
    // commit, so a fixed rate would take 26 minutes to play a 6,000-commit
    // repo and three seconds to play a small one. Pacing by total history
    // instead means every repo plays in about the same wall-clock time.
    this.speedMul = 1;

    this.el = {
      play: document.getElementById('play-btn'),
      scrub: document.getElementById('scrubber'),
      commit: document.getElementById('tl-commit'),
      date: document.getElementById('tl-date'),
      author: document.getElementById('tl-author'),
      alive: document.getElementById('tl-alive'),
      speed: document.getElementById('speed'),
      panel: document.getElementById('timeline'),
    };

    this.el.scrub.max = String(this.last);
    this.el.panel.classList.remove('hidden');

    this._unsub = scene.onFrame((dt) => this._advance(dt));
    this._onPlay = () => this.toggle();
    this._onScrub = (e) => {
      this.pause();
      this.setPlayhead(Number(e.target.value));
      this.city.snap(); // dragging should land on the state instantly
    };
    this._onSpeed = (e) => { this.speedMul = Number(e.target.value); };
    this.el.play.addEventListener('click', this._onPlay);
    this.el.scrub.addEventListener('input', this._onScrub);
    this.el.speed.addEventListener('change', this._onSpeed);

    this.setPlayhead(0);
  }

  dispose() {
    if (this._unsub) this._unsub();
    this.pause();
    this.el.play.removeEventListener('click', this._onPlay);
    this.el.scrub.removeEventListener('input', this._onScrub);
    this.el.speed.removeEventListener('change', this._onSpeed);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    // Restart from the beginning if parked at the end.
    if (this.playhead >= this.last) this.setPlayhead(0);
    this.playing = true;
    this.el.play.textContent = '⏸';
  }

  pause() {
    this.playing = false;
    this.el.play.textContent = '▶';
  }

  setPlayhead(p) {
    this.playhead = Math.max(0, Math.min(this.last, p));
    this.el.scrub.value = String(Math.round(this.playhead));
    this._commitChanged(Math.floor(this.playhead));
  }

  /** Commits per second for this repo at the current multiplier. */
  get commitsPerSecond() {
    const base = Math.max(this.last / PLAYTHROUGH_SECONDS, MIN_COMMITS_PER_SEC);
    return base * this.speedMul;
  }

  _advance(dt) {
    if (!this.playing) return;
    this.playhead += this.commitsPerSecond * dt;
    if (this.playhead >= this.last) {
      this.playhead = this.last;
      this.pause();
    }
    this.el.scrub.value = String(Math.round(this.playhead));
    this._commitChanged(Math.floor(this.playhead));
  }

  _commitChanged(idx) {
    if (idx === this.commit) return;
    this.commit = idx;
    const alive = this.city.setCommit(idx);
    this._renderMeta(idx, alive);
  }

  _renderMeta(idx, alive) {
    const c = this.commits[idx];
    // When a long history is sampled, each step is a frame, not a single commit.
    const label = this.data.sampled ? 'frame' : 'commit';
    this.el.commit.textContent =
      `${label} ${(idx + 1).toLocaleString()} / ${this.commits.length.toLocaleString()}`;
    this.el.alive.textContent = `${alive} building${alive === 1 ? '' : 's'}`;
    if (c) {
      const d = new Date(c.ts * 1000);
      this.el.date.textContent = isNaN(d) ? '—'
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      this.el.author.textContent = c.author || '—';
    }
  }
}
