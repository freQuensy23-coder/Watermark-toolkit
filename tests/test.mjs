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
const worker = read('public/_worker.js');
const buildMeta = JSON.parse(read('public/build.json'));
const wrangler = JSON.parse(read('wrangler.jsonc'));

assert.match(html, /id="singleMode"/);
assert.match(html, /id="bulkMode"/);
assert.match(html, /id="fileInput"/);
assert.match(html, /id="metadataMode"/);
assert.match(html, /value="Tel Aviv, Israel"/);
assert.match(html, /value="32\.0853"/);
assert.match(html, /value="34\.7818"/);
assert.match(html, /iPhone 17 Pro/);
assert.match(html, /Samsung Galaxy Z Fold7/);
assert.match(html, /Sony α7 IV/);
assert.match(html, /Canon EOS R5/);
assert.match(html, /id="compareSlider"/);
assert.match(html, /id="bulkPreview"/);
assert.match(html, /id="downloadButton"/);
assert.ok(html.indexOf('id="workspace"') < html.indexOf('class="settings"'), 'metadata settings must be below the processing area');
assert.equal((html.match(/<button\b/g) || []).length, 3, 'UI must only have Single, Bulk and Download buttons');
for (const removed of ['100% local processing', 'Detection', 'Manual position', 'New image', 'No image upload', 'privacy']) {
  assert.ok(!html.includes(removed), `old UI copy still present: ${removed}`);
}

assert.match(app, /fileInput\.multiple = mode === 'bulk'/);
assert.match(app, /appendBulkPreview\(result\.source, result\.output\)/);
assert.match(app, /bulkPreview\.replaceChildren\(\)/);
assert.ok(!app.includes('if (first) setPreview'), 'bulk mode must not preview only the first file');
assert.match(app, /Download ZIP/);
assert.match(app, /makeZip\(files\)/);
assert.match(app, /0x04034b50/);
assert.match(app, /0x02014b50/);
assert.match(app, /0x06054b50/);
assert.match(app, /pngChunk\('eXIf'/);
assert.match(app, /0x8825/);
assert.match(app, /0x0002/);
assert.match(app, /0x0004/);
assert.match(app, /Apple/);
assert.match(app, /Galaxy Z Fold7/);
assert.match(app, /ILCE-7M4/);
assert.match(app, /Canon EOS R5/);
assert.match(app, /\(src\[i\] - alphaByte\) \/ inv/);
assert.ok(!/fetch\s*\(|XMLHttpRequest|sendBeacon|google-analytics|gtag\s*\(/i.test(app), 'client app must not upload or call external services');
assert.ok(!/https?:\/\//i.test(html + app + css), 'client UI must have no external runtime dependency');
assert.equal(wrangler.name, 'watermark-toolkit');
assert.equal(wrangler.pages_build_output_dir, './public');
assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
assert.match(worker, /token\.actions\.githubusercontent\.com/);
assert.match(worker, /CF_PAGES_TOKEN/);
assert.ok(typeof buildMeta.commit === 'string' && buildMeta.commit.length > 0);

for (const file of [
  'public/app.js',
  'public/_worker.js',
  'scripts/prepare-assets.mjs',
  'scripts/write-build-meta.mjs'
]) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log('All checks passed.');
