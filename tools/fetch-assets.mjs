// Stages runtime ML assets into public/mediapipe/: the SIMD wasm pair comes
// from the installed npm package, the segmenter model downloads once from
// Google's model zoo. Idempotent; runs before dev and build.

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'public', 'mediapipe');
mkdirSync(outDir, { recursive: true });

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const dst = join(outDir, f);
  if (!existsSync(dst) || statSync(dst).size !== statSync(join(wasmSrc, f)).size) {
    copyFileSync(join(wasmSrc, f), dst);
    console.log(`staged ${f}`);
  }
}

const MODELS = [
  {
    file: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    fallback: 'cutouts will fall back to full frames',
  },
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
    fallback: 'body passes will be unavailable',
  },
];

for (const model of MODELS) {
  const dst = join(outDir, model.file);
  if (!existsSync(dst) || statSync(dst).size < 100000) {
    const resp = await fetch(model.url);
    if (!resp.ok) {
      console.warn(`${model.file} download failed (${resp.status}); ${model.fallback}`);
    } else {
      writeFileSync(dst, Buffer.from(await resp.arrayBuffer()));
      console.log(`downloaded ${model.file} (${statSync(dst).size} bytes)`);
    }
  }
}
