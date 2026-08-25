import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');
const pngSize = (path) => {
  const b = fs.readFileSync(path);
  assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${path} is not PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

assert.deepEqual(pngSize('public/assets/gemini-3.5-diamond-36px.png'), [36, 36]);
assert.deepEqual(pngSize('public/assets/gemini-3.6-diamond-48px.png'), [48, 48]);

const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/styles.css');
const wrangler = JSON.parse(read('wrangler.jsonc'));

assert.match(html, /id="fileInput"/);
assert.match(html, /id="downloadButton"/);
assert.match(html, /100% local processing/);
assert.match(app, /deriveLargeMask/);
assert.match(app, /\(src\[i\] - alphaByte\) \/ inv/);
assert.ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon|google-analytics|gtag\s*\(/i.test(app), 'client must not upload data');
assert.ok(!/https?:\/\//i.test(html + app + css), 'public app must have no external runtime dependencies');
assert.equal(wrangler.name, 'watermark-toolkit');
assert.equal(wrangler.assets.directory, './public');

execFileSync(process.execPath, ['--check', 'public/app.js'], { stdio: 'inherit' });

const reverse = (watermarked, alphaByte) => {
  const alpha = alphaByte / 255;
  return (watermarked - alphaByte) / (1 - alpha);
};
for (const original of [0, 17, 64, 128, 220, 255]) {
  for (const alphaByte of [8, 32, 64, 96, 128]) {
    const alpha = alphaByte / 255;
    const watermarked = alphaByte + (1 - alpha) * original;
    assert.ok(Math.abs(reverse(watermarked, alphaByte) - original) < 1e-9);
  }
}

console.log('All checks passed.');
