/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Emits dist/precache.json listing every built file so the service worker
// can precache the shell without a build-time templating step.
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
      const list = files.filter((f) => f !== 'sw.js' && f !== 'precache.json');
      writeFileSync(join(dist, 'precache.json'), JSON.stringify({ files: list }));
    },
  };
}

export default defineConfig({
  base: '/bits/',
  plugins: [react(), precacheManifest()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
