// Plain-DOM overlays: hover tooltip, language legend, HUD, and a status toast.

const $ = (id) => document.getElementById(id);

export const ui = {
  tooltip(building, event, loc) {
    const el = $('tooltip');
    if (!building || !event) { el.classList.add('hidden'); return; }
    el.innerHTML = `
      <div class="t-path">${escapeHtml(building.path)}</div>
      <div class="t-row"><span class="t-dot" style="background:${building.color}"></span>${building.lang}</div>
      <div class="t-row">${loc} lines · peak ${building.maxLoc}</div>`;
    el.classList.remove('hidden');
    // Keep the tooltip on-screen near the cursor.
    const pad = 14;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = event.clientX + pad, y = event.clientY + pad;
    if (x + w > window.innerWidth) x = event.clientX - w - pad;
    if (y + h > window.innerHeight) y = event.clientY - h - pad;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  },

  legend(data) {
    const counts = new Map();
    for (const b of data.buildings) {
      const cur = counts.get(b.lang) || { n: 0, color: b.color };
      cur.n++;
      counts.set(b.lang, cur);
    }
    const rows = [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n)
      .map(([lang, { n, color }]) => `
        <div class="row">
          <span class="sw" style="background:${color}"></span>${lang}
          <span class="cnt">${n}</span>
        </div>`).join('');
    const el = $('legend');
    el.innerHTML = `<h4>Languages</h4>${rows}`;
    el.classList.remove('hidden');
  },

  hud(data) {
    const commits = fmt(data.commitCount);
    const sampled = data.sampled
      ? ` <span title="Long history sampled down for a usable timeline">(${data.frameCount} frames)</span>`
      : '';
    $('hud-repo').innerHTML =
      `<b>${escapeHtml(data.repo)}</b> · ${fmt(data.buildings.length)} files · ${commits} commits${sampled}`;
  },

  status(msg, kind = 'loading') {
    const el = $('status');
    el.className = kind === 'error' ? 'error' : '';
    el.innerHTML = kind === 'loading'
      ? `<div class="spin"></div>${escapeHtml(msg)}`
      : escapeHtml(msg);
    el.classList.remove('hidden');
  },

  hideStatus() { $('status').classList.add('hidden'); },
};

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
