import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return text.replace(from, to);
}

const appPath = 'public/app.js';
let app = fs.readFileSync(appPath, 'utf8');

app = replaceOnce(
  app,
  "  const downloadButton = $('downloadButton');\n",
  "  const downloadButton = $('downloadButton');\n  const synthidStatus = $('synthidStatus');\n",
  'status element'
);

app = replaceOnce(
  app,
  "  function setSinglePreview(source, output) {\n",
  `  function setSynthidStatus(synth) {\n    if (!synth) {\n      synthidStatus.textContent = '';\n      synthidStatus.className = 'synthid-status hidden';\n      return;\n    }\n    synthidStatus.className = 'synthid-status';\n    if (!synth.before?.detected) {\n      synthidStatus.textContent = 'SynthID: not detected';\n      synthidStatus.classList.add('clear');\n    } else if (!synth.after?.detected) {\n      synthidStatus.textContent = 'SynthID: removed';\n      synthidStatus.classList.add('clear');\n    } else {\n      synthidStatus.textContent = 'SynthID: detected';\n      synthidStatus.classList.add('detected');\n    }\n  }\n\n  function setSinglePreview(source, output, synth) {\n`,
  'status helper'
);

app = replaceOnce(
  app,
  "    workspace.classList.remove('hidden');\n  }\n\n  function appendBulkPreview(output, index) {\n",
  "    workspace.classList.remove('hidden');\n    setSynthidStatus(synth);\n  }\n\n  function appendBulkPreview(output, index, synth) {\n",
  'single preview status'
);

app = replaceOnce(
  app,
  "    item.append(canvas);\n\n    const select = () => selectBulkPreview(index);\n",
  `    item.append(canvas);\n    if (synth?.before?.detected) {\n      const badge = document.createElement('span');\n      badge.className = synth.after?.detected ? 'synthid-badge detected' : 'synthid-badge';\n      badge.textContent = synth.after?.detected ? 'SynthID' : 'SynthID ✓';\n      item.append(badge);\n    }\n\n    const select = () => selectBulkPreview(index);\n`,
  'bulk badge'
);

app = replaceOnce(
  app,
  "    workspace.classList.remove('hidden');\n  }\n\n  async function fileToImageData(file) {\n",
  "    workspace.classList.remove('hidden');\n    setSynthidStatus(item.synth);\n  }\n\n  async function fileToImageData(file) {\n",
  'bulk selected status'
);

app = replaceOnce(
  app,
  `  async function processFile(file) {\n    const decoded = await fileToImageData(file);\n    const output = cleanImageData(decoded.imageData, decoded.canvas.width, decoded.canvas.height);\n    decoded.ctx.putImageData(output, 0, 0);\n    const cleanPng = await canvasToPng(decoded.canvas);\n    return { source: decoded.imageData, output, cleanPng };\n  }\n`,
  `  async function processFile(file) {\n    const decoded = await fileToImageData(file);\n    const visibleClean = cleanImageData(decoded.imageData, decoded.canvas.width, decoded.canvas.height);\n    const synth = globalThis.SynthIDToolkit\n      ? await globalThis.SynthIDToolkit.process(visibleClean)\n      : { output: visibleClean, before: { detected: false }, after: { detected: false }, passes: 0 };\n    const output = synth.output;\n    decoded.ctx.putImageData(output, 0, 0);\n    const cleanPng = await canvasToPng(decoded.canvas);\n    return { source: decoded.imageData, output, cleanPng, synth };\n  }\n`,
  'process SynthID'
);

app = replaceOnce(
  app,
  "        setSinglePreview(result.source, result.output);\n",
  "        setSinglePreview(result.source, result.output, result.synth);\n",
  'single result status'
);

app = replaceOnce(
  app,
  `          state.bulk.push({\n            name: baseName(accepted[i].name),\n            file: accepted[i],\n            cleanPng: result.cleanPng\n          });\n          appendBulkPreview(result.output, i);\n`,
  `          state.bulk.push({\n            name: baseName(accepted[i].name),\n            file: accepted[i],\n            cleanPng: result.cleanPng,\n            synth: result.synth\n          });\n          appendBulkPreview(result.output, i, result.synth);\n`,
  'bulk result status'
);

app = replaceOnce(
  app,
  "    workspace.classList.add('hidden');\n    singlePreview.classList.remove('hidden');\n",
  "    workspace.classList.add('hidden');\n    setSynthidStatus(null);\n    singlePreview.classList.remove('hidden');\n",
  'reset status'
);

fs.writeFileSync(appPath, app);

const cssPath = 'public/styles.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('.synthid-status{')) {
  css += '.synthid-status{margin:0 0 10px;font-size:13px;font-weight:650}.synthid-status.clear{color:#16733a}.synthid-status.detected{color:#a32828}.bulk-item{position:relative}.synthid-badge{position:absolute;right:4px;bottom:4px;padding:3px 5px;border-radius:5px;background:rgba(22,115,58,.9);color:#fff;font-size:9px;font-weight:700;line-height:1}.synthid-badge.detected{background:rgba(163,40,40,.92)}';
}
fs.writeFileSync(cssPath, css);

const readmePath = 'README.md';
let readme = fs.readFileSync(readmePath, 'utf8');
readme = replaceOnce(
  readme,
  'Client-side Gemini visible-watermark remover.\n',
  'Client-side Gemini visible-watermark and SynthID processing toolkit.\n',
  'readme title copy'
);
if (!readme.includes('## SynthID')) {
  readme = replaceOnce(
    readme,
    '## Metadata\n',
    `## SynthID\n\nSingle and Bulk run a local phase detector against the published Gemini SynthID carrier families. When detected, the browser automatically applies targeted carrier-phase disruption plus adaptive resampling/compression passes and re-runs the local detector before export. The selected Bulk item shows its SynthID status; thumbnails are marked when SynthID was detected on input.\n\nDetector reference data and carrier research are derived from **reverse-SynthID by Alosh Denny — github.com/aloshdenny/reverse-SynthID** and are used under that project's Research License. This repository does not include Google's private verifier.\n\n## Metadata\n`,
    'readme SynthID section'
  );
}
fs.writeFileSync(readmePath, readme);

const testsPath = 'tests/test.mjs';
let tests = fs.readFileSync(testsPath, 'utf8');
tests = replaceOnce(
  tests,
  "import { execFileSync } from 'node:child_process';\n",
  "import { execFileSync } from 'node:child_process';\nimport vm from 'node:vm';\n",
  'vm import'
);

tests = replaceOnce(
  tests,
  "const css = read('public/styles.css');\n",
  "const css = read('public/styles.css');\nconst synthid = read('public/synthid.js');\nconst synthidData = read('public/synthid-data.js');\n",
  'SynthID test inputs'
);

tests = replaceOnce(
  tests,
  "assert.match(html, /id=\"downloadButton\"/);\n",
  "assert.match(html, /id=\"downloadButton\"/);\nassert.match(html, /id=\"synthidStatus\"/);\nassert.match(html, /synthid-data\\.js/);\nassert.match(html, /synthid\\.js/);\n",
  'SynthID UI tests'
);

tests = replaceOnce(
  tests,
  "assert.match(app, /Download ZIP/);\n",
  "assert.match(app, /Download ZIP/);\nassert.match(app, /SynthIDToolkit\\.process/);\nassert.match(app, /SynthID: removed/);\nassert.match(app, /synth: result\\.synth/);\nassert.match(synthid, /darkRefPhases/);\nassert.match(synthid, /phaseMatch/);\nassert.match(synthid, /disruptionPass/);\nassert.match(synthidData, /darkRefPhases/);\n",
  'SynthID integration tests'
);

tests = replaceOnce(
  tests,
  "  'public/app.js',\n",
  "  'public/app.js',\n  'public/synthid-data.js',\n  'public/synthid.js',\n",
  'syntax tests'
);

if (!tests.includes('SynthID phase math checks passed')) {
  tests += `\n// Pure-math SynthID checks without browser APIs.\nglobalThis.window = globalThis;\nvm.runInThisContext(synthidData, { filename: 'synthid-data.js' });\nvm.runInThisContext(synthid, { filename: 'synthid.js' });\nconst math = globalThis.SynthIDToolkit._math;\n{\n  const re = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]);\n  const im = new Float64Array(8);\n  const original = Array.from(re);\n  math.fft1d(re, im, false);\n  math.fft1d(re, im, true);\n  for (let i = 0; i < original.length; i += 1) assert.ok(Math.abs(re[i] - original[i]) < 1e-8);\n}\n{\n  const size = 512;\n  const spec = { re: new Float64Array(size * size), im: new Float64Array(size * size) };\n  const data = globalThis.SYNTHID_DETECTOR_DATA;\n  for (let i = 0; i < math.DARK.length; i += 1) {\n    const [fy, fx] = math.DARK[i];\n    const phase = data.darkRefPhases[i];\n    const index = ((fy % size + size) % size) * size + ((fx % size + size) % size);\n    spec.re[index] = Math.cos(phase);\n    spec.im[index] = Math.sin(phase);\n  }\n  assert.ok(math.phaseMatch(spec, math.DARK, data.darkRefPhases, size) > 0.999999);\n}\nconsole.log('SynthID phase math checks passed.');\n`;
}
fs.writeFileSync(testsPath, tests);

console.log('SynthID integration patch applied.');
