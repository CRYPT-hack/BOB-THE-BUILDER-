import { Scene } from './scene.js';
import { City } from './city.js';
import { Timeline } from './timeline.js';
import { ui } from './ui.js';
import { analyzeRepo, loadStaticCity } from './api.js';

const scene = new Scene(document.getElementById('app'));

let city = null;
let timeline = null;

// Tooltip shows the file's LIVE line count at the current commit.
scene.onHover = (building, event) => {
  ui.tooltip(building, event, building && city ? city.locOf(building) : 0);
};
// Highlight the hovered instance.
scene.onHoverIndex = (index) => { if (city) city.setHover(index); };

function render(data) {
  if (timeline) timeline.dispose();
  if (city) city.dispose();

  city = new City(scene, data);
  timeline = new Timeline(city, scene, data);
  scene.frameCamera(city.radius);

  // Dev handle for debugging from the console.
  window.__cc = { scene, city, timeline, data };

  ui.hud(data);
  ui.legend(data);
  ui.hideStatus();
  document.title = `CodeCity — ${data.repo}`;
}

async function build(repo) {
  const btn = document.getElementById('repo-btn');
  btn.disabled = true;
  ui.status(`Cloning & analyzing ${repo}…`);
  try {
    const data = await analyzeRepo(repo, (job) => {
      if (job.message) ui.status(job.message);
    });
    render(data);
  } catch (e) {
    ui.status(e.message || 'Something went wrong', 'error');
    setTimeout(() => ui.hideStatus(), 4000);
  } finally {
    btn.disabled = false;
  }
}

// Repo form
document.getElementById('repo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const repo = document.getElementById('repo-input').value.trim();
  if (repo) build(repo);
});

// First load: show the bundled demo city if one was generated.
(async () => {
  try {
    render(await loadStaticCity());
  } catch {
    ui.status('Enter a GitHub repo above to build its city.', 'info');
    setTimeout(() => ui.hideStatus(), 3500);
  }
})();
