(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const singleMode = $('singleMode');
  const bulkMode = $('bulkMode');
  const metadataMode = $('metadataMode');
  const locationName = $('locationName');
  const latitude = $('latitude');
  const longitude = $('longitude');
  const devicePreset = $('devicePreset');
  const customMake = $('customMake');
  const customModel = $('customModel');
  const fileInput = $('fileInput');
  const dropZone = $('dropZone');
  const uploadLabel = $('uploadLabel');
  const workspace = $('workspace');
  const singlePreview = $('singlePreview');
  const bulkPreview = $('bulkPreview');
  const beforeCanvas = $('beforeCanvas');
  const afterCanvas = $('afterCanvas');
  const compareSlider = $('compareSlider');
  const splitLine = $('splitLine');
  const downloadButton = $('downloadButton');

  const beforeCtx = beforeCanvas.getContext('2d', { willReadFrequently: true });
  const afterCtx = afterCanvas.getContext('2d', { willReadFrequently: true });

  const state = {
    mode: 'single',
    singleName: 'image',
    singleReady: false,
    bulk: [],
    processing: false,
    masks: new Map()
  };

  const DEVICE_PRESETS = {
    iphone17pro: { make: 'Apple', model: 'iPhone 17 Pro' },
    fold7: { make: 'Samsung', model: 'Galaxy Z Fold7' },
    sonya7iv: { make: 'SONY', model: 'ILCE-7M4' },
    canonr5: { make: 'Canon', model: 'Canon EOS R5' }
  };

  const MASK_FILES = new Map([
    [36, './assets/gemini-3.5-diamond-36px.png'],
    [48, './assets/gemini-3.6-diamond-48px.png'],
    [96, './assets/gemini-diamond-96px.png']
  ]);

  const clampByte = (value) => value < 0 ? 0 : value > 255 ? 255 : value;

  function buildMask(size, alpha) {
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
    return { size, alpha, samples, meanA, varA: Math.max(varA, 1) };
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

  const masksReady = (async () => {
    state.masks.set(36, await loadMask(36, MASK_FILES.get(36)));
    state.masks.set(48, await loadMask(48, MASK_FILES.get(48)));
    try {
      state.masks.set(96, await loadMask(96, MASK_FILES.get(96)));
    } catch {
      state.masks.set(96, deriveLargeMask(state.masks.get(48)));
    }
  })();

  function luminance(data, pixelIndex) {
    const i = pixelIndex * 4;
    return (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) / 256;
  }

  function correlationAt(source, width, height, mask, x0, y0) {
    if (x0 < 0 || y0 < 0 || x0 + mask.size > width || y0 + mask.size > height) return -1;
    const data = source.data;
    let sumL = 0;
    for (const [x, y] of mask.samples) sumL += luminance(data, (y0 + y) * width + (x0 + x));
    const meanL = sumL / mask.samples.length;
    let cov = 0;
    let varL = 0;
    for (const [x, y, a] of mask.samples) {
      const dl = luminance(data, (y0 + y) * width + (x0 + x)) - meanL;
      cov += (a - mask.meanA) * dl;
      varL += dl * dl;
    }
    if (varL < 1) return 0;
    return cov / Math.sqrt(mask.varA * varL);
  }

  function searchAround(source, width, height, mask, anchorX, anchorY, radius = 16) {
    const anchorScore = correlationAt(source, width, height, mask, anchorX, anchorY);
    let best = { x: anchorX, y: anchorY, score: anchorScore };
    for (let dy = -radius; dy <= radius; dy += 2) {
      for (let dx = -radius; dx <= radius; dx += 2) {
        const x = anchorX + dx;
        const y = anchorY + dy;
        const score = correlationAt(source, width, height, mask, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    const coarse = best;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = coarse.x + dx;
        const y = coarse.y + dy;
        const score = correlationAt(source, width, height, mask, x, y);
        if (score > best.score) best = { x, y, score };
      }
    }
    if (best.score < 0.12 || best.score < anchorScore + 0.04) {
      return { x: anchorX, y: anchorY, score: anchorScore };
    }
    return best;
  }

  function v2SmallMargin(width, height) {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    const sourceLongDim = shortSide >= 566 ? 2752 : shortSide >= 550 ? 2816 : 2848;
    return Math.round(192 * (longSide / sourceLongDim));
  }

  function candidateProfiles(width, height) {
    const shortSide = Math.min(width, height);
    const candidates = [];
    const add = (size, marginRight, marginBottom, priority) => {
      const x = width - marginRight - size;
      const y = height - marginBottom - size;
      if (x >= 0 && y >= 0 && state.masks.has(size)) candidates.push({ size, x, y, priority });
    };
    if (width > 1024 && height > 1024) {
      add(96, 192, 192, 0.20);
      add(96, 64, 64, 0.02);
    } else {
      if (shortSide >= 800) add(48, 96, 96, 0.20);
      const m = v2SmallMargin(width, height);
      add(36, m, m, shortSide < 800 ? 0.18 : 0.03);
      if (shortSide < 800) add(48, 96, 96, 0.02);
      add(48, 32, 32, 0);
    }
    return candidates;
  }

  function detectProfile(source, width, height) {
    let best = null;
    for (const candidate of candidateProfiles(width, height)) {
      const mask = state.masks.get(candidate.size);
      const hit = searchAround(source, width, height, mask, candidate.x, candidate.y, candidate.size === 96 ? 12 : 18);
      const weighted = hit.score + candidate.priority;
      if (!best || weighted > best.weighted) best = { ...candidate, ...hit, weighted };
    }
    return best;
  }

  function cleanImageData(source, width, height) {
    const hit = detectProfile(source, width, height);
    if (!hit) return new ImageData(new Uint8ClampedArray(source.data), width, height);
    const mask = state.masks.get(hit.size);
    const src = source.data;
    const out = new Uint8ClampedArray(src);
    for (let my = 0; my < mask.size; my += 1) {
      const iy = hit.y + my;
      if (iy < 0 || iy >= height) continue;
      for (let mx = 0; mx < mask.size; mx += 1) {
        const ix = hit.x + mx;
        if (ix < 0 || ix >= width) continue;
        const alphaByte = mask.alpha[my * mask.size + mx];
        if (alphaByte <= 1) continue;
        const inv = 1 - alphaByte / 255;
        if (inv <= 0.01) continue;
        const i = (iy * width + ix) * 4;
        out[i] = clampByte((src[i] - alphaByte) / inv);
        out[i + 1] = clampByte((src[i + 1] - alphaByte) / inv);
        out[i + 2] = clampByte((src[i + 2] - alphaByte) / inv);
      }
    }
    return new ImageData(out, width, height);
  }

  function setSinglePreview(source, output) {
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

  async function fileToImageData(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('Unsupported image');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return { canvas, ctx, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) };
  }

  function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
    });
  }

  function currentMetadata() {
    const preset = DEVICE_PRESETS[devicePreset.value];
    const make = devicePreset.value === 'custom' ? customMake.value.trim() : preset?.make || '';
    const model = devicePreset.value === 'custom' ? customModel.value.trim() : preset?.model || '';
    const lat = Number(latitude.value);
    const lon = Number(longitude.value);
    return {
      enabled: metadataMode.value === 'set',
      location: locationName.value.trim(),
      latitude: Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0,
      longitude: Number.isFinite(lon) ? Math.max(-180, Math.min(180, lon)) : 0,
      make,
      model
    };
  }

  const ascii = (value) => new TextEncoder().encode(`${value}\0`);
  const align2 = (value) => value + (value & 1);

  function buildExifTiff(meta) {
    const make = ascii(meta.make || '');
    const model = ascii(meta.model || '');
    const description = ascii(meta.location || '');
    const datum = ascii('WGS-84');
    const ifd0Entries = 4;
    const ifd0Offset = 8;
    const ifd0Size = 2 + ifd0Entries * 12 + 4;
    let cursor = ifd0Offset + ifd0Size;
    const makeOffset = cursor; cursor = align2(cursor + make.length);
    const modelOffset = cursor; cursor = align2(cursor + model.length);
    const descriptionOffset = cursor; cursor = align2(cursor + description.length);
    const gpsOffset = cursor;
    const gpsEntries = 6;
    const gpsSize = 2 + gpsEntries * 12 + 4;
    cursor += gpsSize;
    const latOffset = cursor; cursor += 24;
    const lonOffset = cursor; cursor += 24;
    const datumOffset = cursor; cursor = align2(cursor + datum.length);

    const buffer = new ArrayBuffer(cursor);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes[0] = 0x49; bytes[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, ifd0Offset, true);

    function entry(base, index, tag, type, count, value, inlineBytes = null) {
      const off = base + 2 + index * 12;
      view.setUint16(off, tag, true);
      view.setUint16(off + 2, type, true);
      view.setUint32(off + 4, count, true);
      if (inlineBytes) bytes.set(inlineBytes.slice(0, 4), off + 8);
      else view.setUint32(off + 8, value, true);
    }
    function asciiEntry(base, index, tag, data, offset) {
      entry(base, index, tag, 2, data.length, offset, data.length <= 4 ? data : null);
    }

    view.setUint16(ifd0Offset, ifd0Entries, true);
    asciiEntry(ifd0Offset, 0, 0x010e, description, descriptionOffset);
    asciiEntry(ifd0Offset, 1, 0x010f, make, makeOffset);
    asciiEntry(ifd0Offset, 2, 0x0110, model, modelOffset);
    entry(ifd0Offset, 3, 0x8825, 4, 1, gpsOffset);
    view.setUint32(ifd0Offset + 2 + ifd0Entries * 12, 0, true);
    bytes.set(make, makeOffset);
    bytes.set(model, modelOffset);
    bytes.set(description, descriptionOffset);

    view.setUint16(gpsOffset, gpsEntries, true);
    entry(gpsOffset, 0, 0x0000, 1, 4, 0, new Uint8Array([2, 3, 0, 0]));
    entry(gpsOffset, 1, 0x0001, 2, 2, 0, ascii(meta.latitude < 0 ? 'S' : 'N'));
    entry(gpsOffset, 2, 0x0002, 5, 3, latOffset);
    entry(gpsOffset, 3, 0x0003, 2, 2, 0, ascii(meta.longitude < 0 ? 'W' : 'E'));
    entry(gpsOffset, 4, 0x0004, 5, 3, lonOffset);
    asciiEntry(gpsOffset, 5, 0x0012, datum, datumOffset);
    view.setUint32(gpsOffset + 2 + gpsEntries * 12, 0, true);
    bytes.set(datum, datumOffset);

    function writeCoordinate(offset, coordinate) {
      const value = Math.abs(coordinate);
      const degrees = Math.floor(value);
      const minutesFloat = (value - degrees) * 60;
      const minutes = Math.floor(minutesFloat);
      const secondsNumerator = Math.round((minutesFloat - minutes) * 60 * 10000);
      const values = [[degrees, 1], [minutes, 1], [secondsNumerator, 10000]];
      values.forEach(([numerator, denominator], index) => {
        view.setUint32(offset + index * 8, numerator, true);
        view.setUint32(offset + index * 8 + 4, denominator, true);
      });
    }
    writeCoordinate(latOffset, meta.latitude);
    writeCoordinate(lonOffset, meta.longitude);
    return new Uint8Array(buffer);
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length, false);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, typeBytes.length);
    view.setUint32(8 + data.length, crc32(crcInput), false);
    return chunk;
  }

  async function applyMetadata(cleanPng, meta) {
    if (!meta.enabled) return cleanPng;
    const png = new Uint8Array(await cleanPng.arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => png[index] === byte)) throw new Error('Invalid PNG output');
    const ihdrLength = new DataView(png.buffer, png.byteOffset + 8, 4).getUint32(0, false);
    const insertAt = 8 + 12 + ihdrLength;
    const exif = pngChunk('eXIf', buildExifTiff(meta));
    return new Blob([png.slice(0, insertAt), exif, png.slice(insertAt)], { type: 'image/png' });
  }

  async function processFile(file) {
    const decoded = await fileToImageData(file);
    const output = cleanImageData(decoded.imageData, decoded.canvas.width, decoded.canvas.height);
    decoded.ctx.putImageData(output, 0, 0);
    const cleanPng = await canvasToPng(decoded.canvas);
    return { source: decoded.imageData, output, cleanPng };
  }

  function baseName(name) {
    return (name || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'image';
  }

  async function handleFiles(files) {
    const accepted = [...files].filter((file) => /^image\/(png|jpeg|webp)$/i.test(file.type));
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
        uploadLabel.textContent = `${accepted.length} images`;
        const results = [];
        singlePreview.classList.add('hidden');
        bulkPreview.classList.remove('hidden');
        for (let i = 0; i < accepted.length; i += 1) {
          downloadButton.textContent = `${i + 1}/${accepted.length}`;
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

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  async function makeZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { time, day } = dosDateTime();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, time, true);
      lv.setUint16(12, day, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, day, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setMode(mode) {
    state.mode = mode;
    state.singleReady = false;
    state.bulk = [];
    singleMode.classList.toggle('active', mode === 'single');
    bulkMode.classList.toggle('active', mode === 'bulk');
    fileInput.multiple = mode === 'bulk';
    uploadLabel.textContent = mode === 'bulk' ? 'Choose images' : 'Choose image';
    downloadButton.textContent = mode === 'bulk' ? 'Download ZIP' : 'Download';
    workspace.classList.add('hidden');
    singlePreview.classList.remove('hidden');
    bulkPreview.classList.add('hidden');
    clearBulkPreview();
    fileInput.value = '';
  }

  function updateMetadataControls() {
    const enabled = metadataMode.value === 'set';
    for (const element of [locationName, latitude, longitude, devicePreset, customMake, customModel]) element.disabled = !enabled;
    const custom = enabled && devicePreset.value === 'custom';
    customMake.classList.toggle('hidden', !custom);
    customModel.classList.toggle('hidden', !custom);
  }

  singleMode.addEventListener('click', () => setMode('single'));
  bulkMode.addEventListener('click', () => setMode('bulk'));
  metadataMode.addEventListener('change', updateMetadataControls);
  devicePreset.addEventListener('change', updateMetadataControls);
  fileInput.addEventListener('change', () => handleFiles(fileInput.files || []));

  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    });
  }
  dropZone.addEventListener('drop', (event) => handleFiles(event.dataTransfer?.files || []));

  compareSlider.addEventListener('input', () => {
    const value = Number(compareSlider.value);
    afterCanvas.style.clipPath = `inset(0 0 0 ${value}%)`;
    splitLine.style.left = `${value}%`;
  });

  downloadButton.addEventListener('click', async () => {
    if (state.processing) return;
    downloadButton.disabled = true;
    try {
      const meta = currentMetadata();
      if (state.mode === 'single') {
        if (!state.singleReady) return;
        const cleanPng = await canvasToPng(afterCanvas);
        const output = await applyMetadata(cleanPng, meta);
        downloadBlob(output, `${state.singleName}-clean.png`);
      } else {
        if (!state.bulk.length) return;
        const files = [];
        const used = new Map();
        for (const item of state.bulk) {
          const count = (used.get(item.name) || 0) + 1;
          used.set(item.name, count);
          const suffix = count === 1 ? '' : `-${count}`;
          files.push({
            name: `${item.name}${suffix}-clean.png`,
            blob: await applyMetadata(item.cleanPng, meta)
          });
        }
        downloadBlob(await makeZip(files), 'watermark-toolkit.zip');
      }
    } finally {
      downloadButton.disabled = false;
    }
  });

  updateMetadataControls();
  masksReady.catch((error) => {
    console.error(error);
    downloadButton.disabled = true;
  });
})();
