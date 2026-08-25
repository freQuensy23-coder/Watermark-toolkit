import fs from 'node:fs';

const appPath = 'public/app.js';
const testPath = 'tests/test.mjs';
let app = fs.readFileSync(appPath, 'utf8');
let test = fs.readFileSync(testPath, 'utf8');

function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`Patch target not found: ${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`Patch target is not unique: ${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

app = replaceOnce(app,
`  const workspace = $('workspace');
  const beforeCanvas = $('beforeCanvas');`,
`  const workspace = $('workspace');
  const singlePreview = $('singlePreview');
  const bulkPreview = $('bulkPreview');
  const beforeCanvas = $('beforeCanvas');`,
'DOM preview nodes');

app = replaceOnce(app,
`  function setPreview(source, output) {
    beforeCanvas.width = afterCanvas.width = source.width;
    beforeCanvas.height = afterCanvas.height = source.height;
    beforeCtx.putImageData(source, 0, 0);
    afterCtx.putImageData(output, 0, 0);
    compareSlider.value = '50';
    afterCanvas.style.clipPath = 'inset(0 0 0 50%)';
    splitLine.style.left = '50%';
    workspace.classList.remove('hidden');
  }
`,
`  function setSinglePreview(source, output) {
    beforeCanvas.width = afterCanvas.width = source.width;
    beforeCanvas.height = afterCanvas.height = source.height;
    beforeCtx.putImageData(source, 0, 0);
    afterCtx.putImageData(output, 0, 0);
    compareSlider.value = '50';
    afterCanvas.style.clipPath = 'inset(0 0 0 50%)';
    splitLine.style.left = '50%';
    singlePreview.classList.remove('hidden');
    bulkPreview.classList.add('hidden');
    workspace.classList.remove('hidden');
  }

  function imageDataToCanvas(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas;
  }

  function appendBulkPreview(source, output) {
    const item = document.createElement('div');
    item.className = 'bulk-item';
    const before = document.createElement('canvas');
    const after = document.createElement('canvas');
    const split = document.createElement('div');
    after.className = 'bulk-after';
    split.className = 'bulk-split';

    const targetWidth = Math.min(420, source.width);
    const scale = targetWidth / source.width;
    const targetHeight = Math.max(1, Math.round(source.height * scale));
    before.width = after.width = Math.max(1, Math.round(targetWidth));
    before.height = after.height = targetHeight;

    const sourceCanvas = imageDataToCanvas(source);
    const outputCanvas = imageDataToCanvas(output);
    before.getContext('2d').drawImage(sourceCanvas, 0, 0, before.width, before.height);
    after.getContext('2d').drawImage(outputCanvas, 0, 0, after.width, after.height);
    item.append(before, after, split);
    bulkPreview.append(item);
  }

  function clearBulkPreview() {
    bulkPreview.replaceChildren();
  }
`,
'preview renderer');

app = replaceOnce(app,
`  async function handleFiles(files) {
    const accepted = [...files].filter((file) => /^image\\/(png|jpeg|webp)$/i.test(file.type));
    if (!accepted.length || state.processing) return;
    await masksReady;
    state.processing = true;
    downloadButton.disabled = true;
    workspace.classList.add('hidden');
    try {
      if (state.mode === 'single') {
        const file = accepted[0];
        uploadLabel.textContent = file.name;
        const result = await processFile(file);
        state.singleName = baseName(file.name);
        state.singleReady = true;
        state.bulk = [];
        setPreview(result.source, result.output);
        downloadButton.textContent = 'Download';
      } else {
        uploadLabel.textContent = \`${accepted.length} images\`;
        const results = [];
        let first = null;
        for (let i = 0; i < accepted.length; i += 1) {
          downloadButton.textContent = \`${i + 1}/${accepted.length}\`;
          const result = await processFile(accepted[i]);
          if (!first) first = result;
          results.push({ name: baseName(accepted[i].name), cleanPng: result.cleanPng });
        }
        state.bulk = results;
        state.singleReady = false;
        if (first) setPreview(first.source, first.output);
        downloadButton.textContent = 'Download ZIP';
      }
    } finally {
      state.processing = false;
      downloadButton.disabled = false;
      fileInput.value = '';
    }
  }
`,
`  async function handleFiles(files) {
    const accepted = [...files].filter((file) => /^image\\/(png|jpeg|webp)$/i.test(file.type));
    if (!accepted.length || state.processing) return;
    await masksReady;
    state.processing = true;
    downloadButton.disabled = true;
    workspace.classList.add('hidden');
    clearBulkPreview();
    try {
      if (state.mode === 'single') {
        const file = accepted[0];
        uploadLabel.textContent = file.name;
        const result = await processFile(file);
        state.singleName = baseName(file.name);
        state.singleReady = true;
        state.bulk = [];
        setSinglePreview(result.source, result.output);
        downloadButton.textContent = 'Download';
      } else {
        uploadLabel.textContent = \`${accepted.length} images\`;
        const results = [];
        singlePreview.classList.add('hidden');
        bulkPreview.classList.remove('hidden');
        for (let i = 0; i < accepted.length; i += 1) {
          downloadButton.textContent = \`${i + 1}/${accepted.length}\`;
          const result = await processFile(accepted[i]);
          appendBulkPreview(result.source, result.output);
          results.push({ name: baseName(accepted[i].name), cleanPng: result.cleanPng });
        }
        state.bulk = results;
        state.singleReady = false;
        workspace.classList.remove('hidden');
        downloadButton.textContent = 'Download ZIP';
      }
    } finally {
      state.processing = false;
      downloadButton.disabled = false;
      fileInput.value = '';
    }
  }
`,
'bulk processing');

app = replaceOnce(app,
`    workspace.classList.add('hidden');
    fileInput.value = '';
  }
`,
`    workspace.classList.add('hidden');
    singlePreview.classList.remove('hidden');
    bulkPreview.classList.add('hidden');
    clearBulkPreview();
    fileInput.value = '';
  }
`,
'mode reset');

// Guard against the old broken behavior ever returning.
if (/if \(first\) setPreview/.test(app)) throw new Error('Old first-image-only bulk preview still present');
if (!app.includes('appendBulkPreview(result.source, result.output)')) throw new Error('Bulk preview renderer was not installed');

// Extend static regression coverage.
test = replaceOnce(test,
`assert.match(html, /id="compareSlider"/);
assert.match(html, /id="downloadButton"/);`,
`assert.match(html, /id="compareSlider"/);
assert.match(html, /id="bulkPreview"/);
assert.match(html, /id="downloadButton"/);
assert.ok(html.indexOf('id="workspace"') < html.indexOf('class="settings"'), 'metadata settings must be below the processing area');`,
'HTML regression assertions');

test = replaceOnce(test,
`assert.match(app, /fileInput\\.multiple = mode === 'bulk'/);
assert.match(app, /Download ZIP/);`,
`assert.match(app, /fileInput\\.multiple = mode === 'bulk'/);
assert.match(app, /appendBulkPreview\\(result\\.source, result\\.output\\)/);
assert.match(app, /bulkPreview\\.replaceChildren\\(\\)/);
assert.ok(!app.includes('if (first) setPreview'), 'bulk mode must not preview only the first file');
assert.match(app, /Download ZIP/);`,
'bulk regression assertions');

fs.writeFileSync(appPath, app);
fs.writeFileSync(testPath, test);
console.log('Bulk preview patch applied.');
