import fs from 'node:fs/promises';
import path from 'node:path';

const textFiles = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['public/app.js', 'application/javascript; charset=utf-8']]
]);
const binaryFiles = new Map([
  ['/assets/gemini-3.5-diamond-36px.png', ['public/assets/gemini-3.5-diamond-36px.png', 'image/png']],
  ['/assets/gemini-3.6-diamond-48px.png', ['public/assets/gemini-3.6-diamond-48px.png', 'image/png']],
  ['/assets/gemini-diamond-96px.png', ['public/assets/gemini-diamond-96px.png', 'image/png']]
]);

const textAssets = {};
for (const [urlPath, [file, type]] of textFiles) {
  textAssets[urlPath] = { body: await fs.readFile(file, 'utf8'), type };
}
const binaryAssets = {};
for (const [urlPath, [file, type]] of binaryFiles) {
  binaryAssets[urlPath] = { body: (await fs.readFile(file)).toString('base64'), type };
}

const source = `// Watermark Toolkit production bundle. Generated from repository sources.\nconst TEXT_ASSETS=${JSON.stringify(textAssets)};\nconst BINARY_ASSETS=${JSON.stringify(binaryAssets)};\nconst SECURITY={\n  'X-Content-Type-Options':'nosniff',\n  'X-Frame-Options':'DENY',\n  'Referrer-Policy':'no-referrer',\n  'Content-Security-Policy':\"default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\",\n  'Cache-Control':'no-cache'\n};\nfunction decodeBase64(value){const raw=atob(value);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}\nexport default {async fetch(request){\n  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, HEAD',...SECURITY}});\n  const url=new URL(request.url);\n  const path=url.pathname==='/'?'/':url.pathname.replace(/\\/$/,'');\n  const text=TEXT_ASSETS[path];\n  if(text){const headers={'Content-Type':text.type,...SECURITY};return new Response(request.method==='HEAD'?null:text.body,{status:200,headers});}\n  const binary=BINARY_ASSETS[path];\n  if(binary){const headers={'Content-Type':binary.type,...SECURITY};return new Response(request.method==='HEAD'?null:decodeBase64(binary.body),{status:200,headers});}\n  return new Response('Not Found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8',...SECURITY}});\n}};\n`;

await fs.mkdir('dist', { recursive: true });
await fs.writeFile(path.join('dist', 'worker.mjs'), source);
console.log(`Built dist/worker.mjs (${Buffer.byteLength(source)} bytes).`);
