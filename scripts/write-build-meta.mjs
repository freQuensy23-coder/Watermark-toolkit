import fs from 'node:fs';

const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local';
const branch = process.env.CF_PAGES_BRANCH || process.env.GITHUB_REF_NAME || 'local';
const payload = {
  commit: sha,
  branch,
  platform: process.env.CF_PAGES === '1' ? 'cloudflare-pages' : 'local'
};
fs.writeFileSync('public/build.json', `${JSON.stringify(payload)}\n`);
console.log(`Wrote public/build.json for ${sha}.`);
