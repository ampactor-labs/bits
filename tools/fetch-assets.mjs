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

const MODEL = 'selfie_segmenter.tflite';
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/${MODEL}`;
const modelDst = join(outDir, MODEL);
if (!existsSync(modelDst) || statSync(modelDst).size < 100000) {
  const resp = await fetch(MODEL_URL);
  if (!resp.ok) {
    console.warn(`model download failed (${resp.status}); cutouts will fall back to full frames`);
  } else {
    writeFileSync(modelDst, Buffer.from(await resp.arrayBuffer()));
    console.log(`downloaded ${MODEL} (${statSync(modelDst).size} bytes)`);
  }
}
