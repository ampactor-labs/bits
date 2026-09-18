/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Emits dist/precache.json listing every built file so the service worker
// can precache the shell, and stamps a build hash into dist/sw.js.
//
// The stamp is what makes updates reach installed phones at all: a browser
// only re-runs a worker's install when the worker's own bytes change, and
// sw.js is a static file whose bytes would otherwise be identical forever.
function precacheManifest(): Plugin {
  return {
    name: 'bits:precache-manifest',
    apply: 'build',
    closeBundle() {
      const dist = join(process.cwd(), 'dist');
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(dist, p).replaceAll('\\', '/'));
        }
      };
      walk(dist);
      // mediapipe wasm is ~11MB: runtime-cached on first cutout, not precached.
      const list = files
        .filter((f) => f !== 'sw.js' && f !== 'precache.json' && !f.startsWith('mediapipe/'))
        .sort();
      writeFileSync(join(dist, 'precache.json'), JSON.stringify({ files: list }));

      // Hash the precached file list (names carry Vite's content hashes) so
      // the stamp changes exactly when the shell does.
      const stamp = createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
      const swPath = join(dist, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      if (!sw.includes('__BUILD__')) {
        this.error('sw.js has no __BUILD__ placeholder; updates would never reach installs');
      }
      writeFileSync(swPath, sw.replaceAll('__BUILD__', stamp));
    },
  };
}

export default defineConfig({
  base: '/bits/',
  plugins: [react(), precacheManifest()],
  test: {
    // Per-glob environments (environmentMatchGlobs) were removed in Vitest 4;
    // projects are the supported way to run the pure engine in node and the
    // components in jsdom from one `npm test`.
    projects: [
      {
        extends: true,
        test: {
          name: 'engine',
          environment: 'node',
          include: ['src/engine/**/*.test.ts', 'src/media/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/kit/**/*.test.tsx', 'src/ui/**/*.test.tsx'],
          setupFiles: ['src/test-setup.ts'],
        },
      },
    ],
  },
});
