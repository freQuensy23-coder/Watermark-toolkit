import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = new Map();
function element() {
  return { checked: false, value: '', disabled: false, style: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { this[type] = handler; },
    replaceChildren() { this.children = []; },
    getContext() { return { putImageData() {} }; }
  };
}
const context = vm.createContext({
  document: { getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  } },
  TextEncoder, Blob, Uint8ClampedArray,
  ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
  console: { error() {} }
});
const source = fs.readFileSync('public/app.js', 'utf8');
vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
  let maskLoads = 0;
  let failMasks = false;
  ensureMasks = async () => { maskLoads++; if (failMasks) throw new Error('Masks unavailable'); };
  state.masks.set(36, { size: 36, alpha: new Uint8Array(36 * 36).fill(32) });
  detectProfile = () => ({ size: 36, x: 0, y: 0 });
  fileToImageData = async (file) => ({
    imageData: file.imageData,
    canvas: { width: 1, height: 1 },
    ctx: { putImageData(output) { this.output = output; } }
  });
  canvasToPng = async () => new Blob(['png'], { type: 'image/png' });
  setSinglePreview = (original, output) => { globalThis.preview = output; };
  appendBulkPreview = (output) => { globalThis.outputs.push(output); };
  selectBulkPreview = async () => {};
  globalThis.api = { state, processFile, handleFiles, setMode,
    get maskLoads() { return maskLoads; },
    set failMasks(value) { failMasks = value; } };
})();`), context);
const { api } = context;
const checkbox = elements.get('removeWatermark');
const file = { name: 'original.png', type: 'image/png',
  imageData: { data: new Uint8ClampedArray([120, 130, 140, 255]), width: 1, height: 1 } };
const original = [...file.imageData.data];
for (const mode of ['single', 'bulk']) {
  api.setMode(mode);
  checkbox.checked = false;
  context.outputs = [];
  const files = mode === 'single' ? [file] : [file, { ...file, name: 'second.png' }];
  await api.handleFiles(files);
  const previews = () => mode === 'single' ? [context.preview] : context.outputs.slice(-2);
  for (const output of previews()) assert.deepEqual([...output.data], original);
  const loads = api.maskLoads;
  checkbox.checked = true;
  await checkbox.change();
  assert.equal(api.maskLoads, loads + 1);
  for (const output of previews()) assert.notDeepEqual([...output.data], original);
  checkbox.checked = false;
  await checkbox.change();
  assert.equal(api.maskLoads, loads + 1, 'metadata-only processing must not load masks');
  for (const output of previews()) assert.deepEqual([...output.data], original, 'toggle off restores original pixels');
  assert.deepEqual([...file.imageData.data], original, 'original must remain unchanged');
  assert.equal(api.state.processing, false);
  assert.equal(checkbox.disabled, false);
}
api.failMasks = true;
checkbox.checked = true;
await checkbox.change();
assert.match(elements.get('processingStatus').textContent, /Could not process/);
assert.equal(api.state.bulk.length, 0, 'failed processing cannot leave stale downloads');
checkbox.checked = false;
await checkbox.change();
assert.equal(api.state.bulk.length, 2, 'metadata-only processing works even if masks fail');
assert.equal(elements.get('processingStatus').textContent, '');
console.log('Watermark toggle behavior passed for Single and Bulk.');
