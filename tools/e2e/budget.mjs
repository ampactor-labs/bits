// Initial payload budget.
//
// Counting the entry chunk alone under-reports by about half: index.html
// also modulepreloads the vendor chunk, so the browser fetches both before
// first paint. This sums every script the document pulls in eagerly.

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET_KB = 450;
const dist = join(process.cwd(), 'dist');
const indexPath = join(dist, 'index.html');

if (!existsSync(indexPath)) {
  console.error('no dist/index.html; run npm run build first');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const eager = new Set();
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) eager.add(m[1]);
for (const m of html.matchAll(/rel="modulepreload"[^>]+href="([^"]+)"/g)) eager.add(m[1]);
for (const m of html.matchAll(/href="([^"]+)"[^>]+rel="modulepreload"/g)) eager.add(m[1]);

const rows = [];
let total = 0;
for (const href of eager) {
  const rel = href.replace(/^\/bits\//, '').replace(/^\//, '');
  const file = join(dist, rel);
  if (!existsSync(file)) continue;
  const gz = gzipSync(readFileSync(file)).length;
  total += gz;
  rows.push({ rel, gz });
}

rows.sort((a, b) => b.gz - a.gz);
for (const r of rows) console.log(`${(r.gz / 1024).toFixed(1).padStart(7)} KB gz  ${r.rel}`);

const totalKb = total / 1024;
console.log(`${totalKb.toFixed(1).padStart(7)} KB gz  TOTAL (budget ${BUDGET_KB} KB)`);

if (rows.length === 0) {
  console.error('budget check found no eager scripts; the parser is wrong');
  process.exit(1);
}
if (totalKb > BUDGET_KB) {
  console.error(`\nover budget by ${(totalKb - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
console.log('\nwithin budget');
