import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const appPath = 'public/app.js';
let app = fs.readFileSync(appPath, 'utf8');

function replaceOnce(pattern, replacement, label) {
  const next = app.replace(pattern, replacement);
  if (next === app) throw new Error(`Patch failed: ${label}`);
  app = next;
}

replaceOnce(
  "    bulk: [],\n    processing: false,",
  "    bulk: [],\n    bulkSelected: -1,\n    processing: false,",
  'bulkSelected state'
);

replaceOnce(
  /  function imageDataToCanvas\(imageData\) \{[\s\S]*?  function clearBulkPreview\(\) \{\n    bulkPreview\.replaceChildren\(\);\n  \}\n/,
`  function appendBulkPreview(output, index) {
    const item = document.createElement('div');
    item.className = 'bulk-item';
    item.dataset.index = String(index);
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', \`Preview image \${index + 1}\`);

    const canvas = document.createElement('canvas');
    const targetWidth = Math.min(220, output.width);
    const scale = targetWidth / output.width;
    canvas.width = Math.max(1, Math.round(targetWidth));
    canvas.height = Math.max(1, Math.round(output.height * scale));
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = output.width;
    sourceCanvas.height = output.height;
    sourceCanvas.getContext('2d').putImageData(output, 0, 0);
    canvas.getContext('2d').drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
    item.append(canvas);

    const select = () => selectBulkPreview(index);
    item.addEventListener('click', select);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    bulkPreview.append(item);
  }

  function clearBulkPreview() {
    bulkPreview.replaceChildren();
    state.bulkSelected = -1;
  }

  async function selectBulkPreview(index) {
    const item = state.bulk[index];
    if (!item || state.mode !== 'bulk') return;
    state.bulkSelected = index;
    for (const element of bulkPreview.children) {
      element.classList.toggle('selected', Number(element.dataset.index) === index);
    }

    const [sourceDecoded, outputDecoded] = await Promise.all([
      fileToImageData(item.file),
      fileToImageData(item.cleanPng)
    ]);
    if (state.mode !== 'bulk' || state.bulkSelected !== index) return;

    const source = sourceDecoded.imageData;
    const output = outputDecoded.imageData;
    beforeCanvas.width = afterCanvas.width = source.width;
    beforeCanvas.height = afterCanvas.height = source.height;
    beforeCtx.putImageData(source, 0, 0);
    afterCtx.putImageData(output, 0, 0);
    compareSlider.value = '50';
    afterCanvas.style.clipPath = 'inset(0 0 0 50%)';
    splitLine.style.left = '50%';
    singlePreview.classList.remove('hidden');
    bulkPreview.classList.remove('hidden');
    workspace.classList.remove('hidden');
  }
`,
  'bulk preview functions'
);

replaceOnce(
`      } else {
        uploadLabel.textContent = \`\${accepted.length} images\`;
        const results = [];
        singlePreview.classList.add('hidden');
        bulkPreview.classList.remove('hidden');
        for (let i = 0; i < accepted.length; i += 1) {
          downloadButton.textContent = \`\${i + 1}/\${accepted.length}\`;
          const result = await processFile(accepted[i]);
          appendBulkPreview(result.source, result.output);
          results.push({ name: baseName(accepted[i].name), cleanPng: result.cleanPng });
        }
        state.bulk = results;
        state.singleReady = false;
        workspace.classList.remove('hidden');
        downloadButton.textContent = 'Download ZIP';
      }`,
`      } else {
        uploadLabel.textContent = \`\${accepted.length} images\`;
        state.bulk = [];
        state.bulkSelected = -1;
        state.singleReady = false;
        singlePreview.classList.add('hidden');
        bulkPreview.classList.remove('hidden');
        workspace.classList.remove('hidden');
        for (let i = 0; i < accepted.length; i += 1) {
          downloadButton.textContent = \`\${i + 1}/\${accepted.length}\`;
          const result = await processFile(accepted[i]);
          state.bulk.push({
            name: baseName(accepted[i].name),
            file: accepted[i],
            cleanPng: result.cleanPng
          });
          appendBulkPreview(result.output, i);
        }
        if (state.bulk.length) await selectBulkPreview(0);
        downloadButton.textContent = 'Download ZIP';
      }`,
  'bulk handleFiles branch'
);

replaceOnce(
  "    state.bulk = [];\n    singleMode.classList.toggle",
  "    state.bulk = [];\n    state.bulkSelected = -1;\n    singleMode.classList.toggle",
  'mode reset'
);

fs.writeFileSync(appPath, app);
execFileSync(process.execPath, ['--check', appPath], { stdio: 'inherit' });

const workflowPath = '.github/workflows/fix-bulk-preview.yml';
fs.rmSync('scripts/fix-bulk-preview.mjs');
fs.rmSync(workflowPath);

execFileSync('git', ['config', 'user.name', 'github-actions'], { stdio: 'inherit' });
execFileSync('git', ['config', 'user.email', 'github-actions@github.com'], { stdio: 'inherit' });
execFileSync('git', ['add', '-A'], { stdio: 'inherit' });
execFileSync('git', ['commit', '-m', 'fix: make bulk previews selectable'], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'HEAD:main'], { stdio: 'inherit' });
