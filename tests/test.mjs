import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const read = (path) => fs.readFileSync(path, 'utf8');
const bytes = (path) => fs.readFileSync(path);
const pngSize = (path) => {
  const b = bytes(path);
  assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${path} is not PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const gitBlobSha = (path) => {
  const b = bytes(path);
  return crypto.createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
};

const assets = [
  ['public/assets/gemini-3.5-diamond-36px.png', [36, 36], '3fcf55a924c59b7c34322fc0206a05a453eff68a'],
  ['public/assets/gemini-3.6-diamond-48px.png', [48, 48], 'a4e9df4cef7b6efa34634a150f46aa071f11bf0f'],
  ['public/assets/gemini-diamond-96px.png', [96, 96], 'b6dce36037c4b2d16f77628f7e28d8c1bbbb795e']
];
for (const [path, size, sha] of assets) {
  assert.deepEqual(pngSize(path), size);
  assert.equal(gitBlobSha(path), sha, `${path} does not match the pinned upstream asset`);
}

const html = read('public/index.html');
const app = read('public/app.js');
const css = read('public/styles.css');
const wrangler = JSON.parse(read('wrangler.jsonc'));
const bundle = read('dist/worker.mjs');
const deployer = read('scripts/cicd-deployer.mjs');

assert.match(html, /id="fileInput"/);
assert.match(html, /id="downloadButton"/);
assert.match(html, /100% local processing/);
assert.match(app, /gemini-diamond-96px\.png/);
assert.match(app, /best\.score < 0\.12/);
assert.match(app, /\(src\[i\] - alphaByte\) \/ inv/);
assert.ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon|google-analytics|gtag\s*\(/i.test(app), 'client must not upload data');
assert.ok(!/https?:\/\//i.test(html + app + css), 'public app must have no external runtime dependencies');
assert.equal(wrangler.name, 'watermark-toolkit');
assert.equal(wrangler.assets.directory, './public');
assert.match(bundle, /Watermark Toolkit production bundle/);
assert.match(bundle, /gemini-diamond-96px\.png/);
assert.match(bundle, /connect-src 'none'/);
assert.match(deployer, /EXPECTED_REPOSITORY_ID = '1346650339'/);
assert.match(deployer, /token\.actions\.githubusercontent\.com\/\.well-known\/jwks/);
assert.match(deployer, /payload\.ref !== 'refs\/heads\/main'/);

for (const file of [
  'public/app.js',
  'scripts/prepare-assets.mjs',
  'scripts/build-worker.mjs',
  'scripts/cicd-deployer.mjs',
  'scripts/render-bootstrap.mjs',
  'dist/worker.mjs'
]) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

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
