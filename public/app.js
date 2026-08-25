(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fileInput = $('fileInput');
  const dropZone = $('dropZone');
  const workspace = $('workspace');
  const beforeCanvas = $('beforeCanvas');
  const afterCanvas = $('afterCanvas');
  const previewWrap = $('previewWrap');
  const compareSlider = $('compareSlider');
  const splitLine = $('splitLine');
  const statusText = $('statusText');
  const manualButton = $('manualButton');
  const manualPanel = $('manualPanel');
  const cancelManual = $('cancelManual');
  const maskSize = $('maskSize');
  const newImage = $('newImage');
  const downloadButton = $('downloadButton');

  const beforeCtx = beforeCanvas.getContext('2d', { willReadFrequently: true });
  const afterCtx = afterCanvas.getContext('2d', { willReadFrequently: true });

  const state = {
    width: 0,
    height: 0,
    source: null,
    output: null,
    fileName: 'gemini-image',
    manual: false,
    masks: new Map()
  };

  const MASK_FILES = new Map([
    [36, './assets/gemini-3.5-diamond-36px.png'],
    [48, './assets/gemini-3.6-diamond-48px.png']
  ]);

  const clampByte = (value) => value < 0 ? 0 : value > 255 ? 255 : value;

  function buildMask(size, alpha) {
    let max = 0;
    for (const value of alpha) if (value > max) max = value;
    const step = size >= 96 ? 4 : 2;
    const samples = [];
    let sumA = 0;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        const a = alpha[y * size + x];
        samples.push([x, y, a]);
        sumA += a;
      }
    }
    const meanA = sumA / samples.length;
    let varA = 0;
    for (const sample of samples) {
      const d = sample[2] - meanA;
      varA += d * d;
    }
    return { size, alpha, samples, meanA, varA: Math.max(varA, 1), max };
  }

  async function loadMask(size, src) {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, size, size);
    const rgba = ctx.getImageData(0, 0, size, size).data;
    const alpha = new Uint8Array(size * size);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) alpha[p] = rgba[i];
    return buildMask(size, alpha);
  }

  function deriveLargeMask(small) {
    const alpha = new Uint8Array(96 * 96);
    const scale = 1.62;
    for (let y = 0; y < 96; y += 1) {
      const sy = y / 2;
      const y0 = Math.floor(sy);
      const y1 = Math.min(47, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < 96; x += 1) {
        const sx = x / 2;
        const x0 = Math.floor(sx);
        const x1 = Math.min(47, x0 + 1);
        const fx = sx - x0;
        const a00 = small.alpha[y0 * 48 + x0];
        const a10 = small.alpha[y0 * 48 + x1];
        const a01 = small.alpha[y1 * 48 + x0];
        const a11 = small.alpha[y1 * 48 + x1];
        const top = a00 * (1 - fx) + a10 * fx;
        const bottom = a01 * (1 - fx) + a11 * fx;
        alpha[y * 96 + x] = clampByte((top * (1 - fy) + bottom * fy) * scale);
      }
    }
    return buildMask(96, alpha);
  }

  const masksReady = Promise.all([...MASK_FILES].map(async ([size, src]) => {
    const mask = await loadMask(size, src);
    state.masks.set(size, mask);
  })).then(() => {
    state.masks.set(96, deriveLargeMask(state.masks.get(48)));
  });

  function luminance(data, pixelIndex) {
    const i = pixelIndex * 4;
    return (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) / 256;
  }

  function correlationAt(mask, x0, y0) {
    if (x0 < 0 || y0 < 0 || x0 + mask.size > state.width || y0 + mask.size > state.height) return -1;
    const data = state.source.data;
    let sumL = 0;
    for (const [x, y] of mask.samples) sumL += luminance(data, (y0 + y) * state.width + (x0 + x));
    const meanL = sumL / mask.samples.length;
    let cov = 0;
    let varL = 0;
    for (const [x, y, a] of mask.samples) {
      const dl = luminance(data, (y0 + y) * state.width + (x0 + x)) - meanL;
      cov += (a - mask.meanA) * dl;
      varL += dl * dl;
    }
    if (varL < 1) return 0;
    return cov / Math.sqrt(mask.varA * varL);
  }

  function searchAround(mask, anchorX, anchorY, radius = 16) {
    let best = { x: anchorX, y: anchorY, score: correlationAt(mask, anchorX, anchorY) };
    for (let dy = -radius; dy <= radius; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        const x = anchorX + dx;
        const y = anchorY + dy;
        const score = correlationAt(mask, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    const coarse = best;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = coarse.x + dx;
        const y = coarse.y + dy;
        const score = correlationAt(mask, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    return best;
  }

  function v2SmallMargin(width, height) {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    const sourceLongDim = shortSide >= 566 ? 2752 : shortSide >= 550 ? 2816 : 2848;
    return Math.round(192 * (longSide / sourceLongDim));
  }

  function candidateProfiles() {
    const w = state.width;
    const h = state.height;
    const shortSide = Math.min(w, h);
    const candidates = [];
    const add = (size, marginRight, marginBottom, label, priority) => {
      const x = w - marginRight - size;
      const y = h - marginBottom - size;
      if (x >= 0 && y >= 0 && state.masks.has(size)) candidates.push({ size, x, y, label, priority });
    };

    if (w > 1024 && h > 1024) {
      add(96, 192, 192, 'Gemini large · 96 px', 0.20);
      add(96, 64, 64, 'Gemini legacy large · 96 px', 0.02);
    } else {
      if (shortSide >= 800) add(48, 96, 96, 'Gemini 3.6 · 48 px', 0.20);
      const m = v2SmallMargin(w, h);
      add(36, m, m, 'Gemini 3.5 · 36 px', shortSide < 800 ? 0.18 : 0.03);
      add(48, 96, 96, 'Gemini 3.6 · 48 px', shortSide >= 800 ? 0.16 : 0.02);
      add(48, 32, 32, 'Gemini legacy · 48 px', 0.00);
    }
    return candidates;
  }

  function detectProfile() {
    const candidates = candidateProfiles();
    let best = null;
    for (const candidate of candidates) {
      const mask = state.masks.get(candidate.size);
      const hit = searchAround(mask, candidate.x, candidate.y, candidate.size === 96 ? 12 : 18);
      const weighted = hit.score + candidate.priority;
      if (!best || weighted > best.weighted) best = { ...candidate, ...hit, weighted };
    }
    return best;
  }

  function applyMask(mask, x0, y0) {
    const src = state.source.data;
    const out = new Uint8ClampedArray(src);
    const w = state.width;
    for (let my = 0; my < mask.size; my += 1) {
      const iy = y0 + my;
      if (iy < 0 || iy >= state.height) continue;
      for (let mx = 0; mx < mask.size; mx += 1) {
        const ix = x0 + mx;
        if (ix < 0 || ix >= state.width) continue;
        const alphaByte = mask.alpha[my * mask.size + mx];
        if (alphaByte <= 1) continue;
        const alpha = alphaByte / 255;
        const inv = 1 - alpha;
        if (inv <= 0.01) continue;
        const i = (iy * w + ix) * 4;
        out[i] = clampByte((src[i] - alphaByte) / inv);
        out[i + 1] = clampByte((src[i + 1] - alphaByte) / inv);
        out[i + 2] = clampByte((src[i + 2] - alphaByte) / inv);
      }
    }
    state.output = new ImageData(out, state.width, state.height);
    afterCtx.putImageData(state.output, 0, 0);
  }

  function autoProcess() {
    const hit = detectProfile();
    if (!hit) {
      statusText.textContent = 'Could not select a watermark profile';
      state.output = new ImageData(new Uint8ClampedArray(state.source.data), state.width, state.height);
      afterCtx.putImageData(state.output, 0, 0);
      return;
    }
    applyMask(state.masks.get(hit.size), hit.x, hit.y);
    const confidence = Number.isFinite(hit.score) ? Math.max(0, Math.min(1, hit.score)) : 0;
    statusText.textContent = `${hit.label} · auto · match ${Math.round(confidence * 100)}%`;
  }

  async function decodeFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      statusText.textContent = 'Please choose a PNG, JPEG, or WebP image';
      return;
    }
    await masksReady;
    const bitmap = await createImageBitmap(file);
    state.width = bitmap.width;
    state.height = bitmap.height;
    state.fileName = (file.name || 'gemini-image').replace(/\.[^.]+$/, '');
    beforeCanvas.width = afterCanvas.width = state.width;
    beforeCanvas.height = afterCanvas.height = state.height;
    beforeCtx.clearRect(0, 0, state.width, state.height);
    beforeCtx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    state.source = beforeCtx.getImageData(0, 0, state.width, state.height);
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
    setManual(false);
    autoProcess();
  }

  function setManual(enabled) {
    state.manual = enabled;
    manualPanel.classList.toggle('hidden', !enabled);
    previewWrap.classList.toggle('manual-mode', enabled);
    manualButton.textContent = enabled ? 'Pick watermark below' : 'Manual position';
  }

  function reset() {
    state.source = null;
    state.output = null;
    state.width = state.height = 0;
    fileInput.value = '';
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    setManual(false);
  }

  fileInput.addEventListener('change', () => decodeFile(fileInput.files?.[0]));
  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); });
  }
  dropZone.addEventListener('drop', (event) => decodeFile(event.dataTransfer?.files?.[0]));
  window.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
    if (file) decodeFile(file);
  });

  compareSlider.addEventListener('input', () => {
    const value = Number(compareSlider.value);
    afterCanvas.style.clipPath = `inset(0 0 0 ${value}%)`;
    splitLine.style.left = `${value}%`;
  });

  manualButton.addEventListener('click', () => setManual(true));
  cancelManual.addEventListener('click', () => setManual(false));
  newImage.addEventListener('click', reset);
  previewWrap.addEventListener('click', (event) => {
    if (!state.manual || !state.source) return;
    const size = Number(maskSize.value);
    const mask = state.masks.get(size);
    if (!mask) return;
    const rect = beforeCanvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) * (state.width / rect.width);
    const py = (event.clientY - rect.top) * (state.height / rect.height);
    const x = Math.round(px - size / 2);
    const y = Math.round(py - size / 2);
    applyMask(mask, x, y);
    statusText.textContent = `Manual · ${size} px · x ${x}, y ${y}`;
    setManual(false);
  });

  downloadButton.addEventListener('click', () => {
    if (!state.output) return;
    afterCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${state.fileName}-clean.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  });

  masksReady.catch((error) => {
    console.error(error);
    statusText.textContent = 'Failed to load local watermark masks';
  });
})();
