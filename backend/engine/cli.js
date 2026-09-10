// Standalone tester for the data engine:
//   node engine/cli.js <repoPath> [outFile]
// Writes City Timeline JSON and prints a summary so we can verify the engine
// before any web wiring exists.

import { writeFileSync } from 'node:fs';
import { buildCity } from './buildCity.js';

const repoPath = process.argv[2];
const outFile = process.argv[3] || 'city.json';

if (!repoPath) {
  console.error('usage: node engine/cli.js <repoPath> [outFile]');
  process.exit(1);
}

const t0 = Date.now();
const city = await buildCity(repoPath);
city.generatedAt = new Date().toISOString();
writeFileSync(outFile, JSON.stringify(city));
const ms = Date.now() - t0;

// Summary
const byLang = new Map();
for (const b of city.buildings) byLang.set(b.lang, (byLang.get(b.lang) || 0) + 1);

console.log(`\n  ${city.repo}`);
console.log(`  ${'-'.repeat(city.repo.length)}`);
console.log(`  commits:   ${city.commitCount.toLocaleString()}`);
console.log(`  frames:    ${city.frameCount.toLocaleString()}${city.sampled ? ' (sampled)' : ''}`);
console.log(`  buildings: ${city.buildings.length.toLocaleString()}`);
console.log(`  languages: ${[...byLang.entries()].sort((a, b) => b[1] - a[1])
  .map(([l, n]) => `${l}(${n})`).join(', ')}`);
console.log(`  analyzed in ${ms}ms -> ${outFile} (${(JSON.stringify(city).length / 1024).toFixed(0)} KB)\n`);

console.log('  tallest buildings (peak LOC):');
for (const b of [...city.buildings].sort((a, b) => b.maxLoc - a.maxLoc).slice(0, 8)) {
  console.log(`    ${String(b.maxLoc).padStart(6)}  ${b.lang.padEnd(11)} ${b.path}`);
}
console.log('');
