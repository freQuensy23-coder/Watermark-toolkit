import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'public/assets/gemini-diamond-96px.png');
const URL = 'https://raw.githubusercontent.com/froggeric/gemini-watermark-and-synthid-remover/5918384ce403968de0560cefd889e50eba0163bc/assets/watermark-masks/gemini-diamond-96px.png';
const EXPECTED_GIT_BLOB_SHA = 'b6dce36037c4b2d16f77628f7e28d8c1bbbb795e';

function gitBlobSha(buffer) {
  return crypto.createHash('sha1')
    .update(Buffer.from(`blob ${buffer.length}\0`))
    .update(buffer)
    .digest('hex');
}

const response = await fetch(URL, { redirect: 'error' });
if (!response.ok) throw new Error(`Failed to fetch pinned 96px mask: HTTP ${response.status}`);
const buffer = Buffer.from(await response.arrayBuffer());
const actual = gitBlobSha(buffer);
if (actual !== EXPECTED_GIT_BLOB_SHA) {
  throw new Error(`96px mask integrity check failed: ${actual}`);
}
await fs.mkdir(path.dirname(TARGET), { recursive: true });
await fs.writeFile(TARGET, buffer);
console.log(`Prepared exact 96px mask (${actual}).`);
