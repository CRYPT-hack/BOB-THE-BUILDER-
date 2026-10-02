// Drives the commit playhead: play/pause, scrub, speed, and stepping between
// eras. On every frame it advances a floating playhead while playing, and
// whenever the integer commit index changes it tells the City to grow toward
// that commit's state and notifies anything else following the playhead.

import { eras, date, year } from './insights.js';

// Roughly how long a full playthrough should take at 1x, whatever the repo.
const PLAYTHROUGH_SECONDS = 100;
// Floor so a tiny repo doesn't crawl one commit every two seconds.
const MIN_COMMITS_PER_SEC = 1.5;

const $ = (id) => document.getElementById(id);

export class Timeline {
  constructor(city, scene, data) {
    this.city = city;
    this.data = data;
    this.commits = data.commits;
    this.last = Math.max(0, this.commits.length - 1);
    this.eras = eras(data);
    this.listeners = new Set();

    this.playhead = 0;
    this.commit = -1;
    this.playing = false;
    // Speed is a MULTIPLIER, not a commit rate. The timeline is one frame per
    // commit, so a fixed rate would take 26 minutes to play a 6,000-commit
    // repo and three seconds to play a small one. Pacing by total history
    // instead means every repo plays in about the same wall-clock time.
    this.speedMul = 1;

    this.el = {
      play: $('play-btn'),
      icon: $('play-icon'),
      scrub: $('scrubber'),
      subject: $('commit-subject'),
      meta: $('commit-meta'),
      date: $('commit-date'),
      speed: $('speed'),
      prev: $('era-prev'),
      next: $('era-next'),
    };
    this.el.scrub.max = String(this.last);
    $('track-start').textContent = year(this.commits[0]?.ts);
    $('track-end').textContent = 'Present';

    this._on = [
      [this.el.play, 'click', () => this.toggle()],
      [this.el.scrub, 'input', (e) => {
        this.pause();
        this.setPlayhead(Number(e.target.value));
        this.city.snap(); // dragging should land on the state instantly
      }],
      [this.el.speed, 'click', (e) => {
        const b = e.target.closest('button[data-speed]');
        if (!b) return;
        this.speedMul = Number(b.dataset.speed);
        for (const x of this.el.speed.children) x.classList.toggle('active', x === b);
      }],
      [this.el.prev, 'click', () => this.stepEra(-1)],
      [this.el.next, 'click', () => this.stepEra(1)],
    ];
    for (const [el, ev, fn] of this._on) el.addEventListener(ev, fn);

    this._unsub = scene.onFrame((dt) => this._advance(dt));
    this.setPlayhead(0);
  }

  dispose() {
    if (this._unsub) this._unsub();
    this.pause();
    for (const [el, ev, fn] of this._on) el.removeEventListener(ev, fn);
    this.listeners.clear();
  }

  /** Subscribe to commit changes: fn(commitIndex, aliveCount). */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    // Restart from the beginning if parked at the end.
    if (this.playhead >= this.last) this.setPlayhead(0);
    this.playing = true;
    this.el.icon.textContent = 'pause';
    this._emit();
  }

  pause() {
    this.playing = false;
    this.el.icon.textContent = 'play_arrow';
    this._emit();
  }

  /** Jump to a commit and settle there immediately. */
  seek(idx) {
    this.pause();
    this.setPlayhead(idx);
    this.city.snap();
  }

  /** Jump to the start of the previous or next era. */
  stepEra(dir) {
    if (!this.eras.length) return;
    const cur = Math.floor(this.playhead);
    const starts = this.eras.map((e) => e.from).concat(this.last);
    const target = dir > 0
      ? starts.find((s) => s > cur) ?? this.last
      : [...starts].reverse().find((s) => s < cur) ?? 0;
    this.seek(target);
  }

  setPlayhead(p) {
    this.playhead = Math.max(0, Math.min(this.last, p));
    this._syncTrack();
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
    this._syncTrack();
    this._commitChanged(Math.floor(this.playhead));
  }

  _syncTrack() {
    this.el.scrub.value = String(Math.round(this.playhead));
    const pct = this.last ? (this.playhead / this.last) * 100 : 100;
    this.el.scrub.style.setProperty('--pct', `${pct}%`);
  }

  _commitChanged(idx) {
    if (idx === this.commit) return;
    this.commit = idx;
    this.alive = this.city.setCommit(idx);
    this._renderMeta(idx);
    this._emit();
  }

  _emit() {
    for (const fn of this.listeners) fn(this.commit, this.alive, this.playing);
  }

  _renderMeta(idx) {
    const c = this.commits[idx];
    if (!c) return;
    // Sampled histories step by frame, not by single commit.
    const unit = this.data.sampled ? 'frame' : 'commit';
    this.el.subject.textContent = c.subject || `${unit} ${idx + 1}`;
    this.el.subject.title = c.subject || '';
    this.el.meta.textContent =
      `${unit} ${(idx + 1).toLocaleString()}/${this.commits.length.toLocaleString()} · ${c.sha.slice(0, 7)} · by ${c.author}`;
    this.el.date.textContent = date(c.ts);
  }
}
