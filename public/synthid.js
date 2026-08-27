(() => {
  'use strict';

  const DATA = globalThis.SYNTHID_DETECTOR_DATA || {};
  const SIZE = DATA.imageSize || 512;
  const DARK = [
    [-5,-3],[5,3],[-5,3],[5,-3],[-3,-4],[3,4],[-3,4],[3,-4],
    [-4,-3],[4,3],[-4,3],[4,-3],[-5,-1],[5,1],[-5,1],[5,-1],
    [-5,-2],[5,2],[-5,2],[5,-2],[-2,-5],[2,5],[-2,5],[2,-5],
    [-1,-5],[1,5],[-1,5],[1,-5],[-4,-4],[4,4],[-4,4],[4,-4],
    [-1,-6],[1,6],[-3,-5],[3,5]
  ];
  const WHITE = [
    [0,-7],[0,7],[0,-8],[0,8],[0,-9],[0,9],[0,-10],[0,10],
    [0,-11],[0,11],[0,-12],[0,12],[0,-20],[0,20],[0,-21],[0,21],
    [0,-22],[0,22],[0,-23],[0,23]
  ];
  const THRESHOLD = Number(DATA.threshold || 0.80);
  const TWO_PI = Math.PI * 2;

  const mod = (value, n) => ((value % n) + n) % n;
  const clampByte = (value) => value < 0 ? 0 : value > 255 ? 255 : value;
  const wrapAngle = (value) => Math.atan2(Math.sin(value), Math.cos(value));
  const sigmoid = (value) => 1 / (1 + Math.exp(-value));

  function fft1d(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = (inverse ? 2 : -2) * Math.PI / len;
      const wLenRe = Math.cos(angle);
      const wLenIm = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let wRe = 1;
        let wIm = 0;
        const half = len >> 1;
        for (let j = 0; j < half; j += 1) {
          const uRe = re[i + j];
          const uIm = im[i + j];
          const vr = re[i + j + half];
          const vi = im[i + j + half];
          const vRe = vr * wRe - vi * wIm;
          const vIm = vr * wIm + vi * wRe;
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + half] = uRe - vRe;
          im[i + j + half] = uIm - vIm;
          const nextRe = wRe * wLenRe - wIm * wLenIm;
          wIm = wRe * wLenIm + wIm * wLenRe;
          wRe = nextRe;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i += 1) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  function fft2(re, im, size = SIZE, inverse = false) {
    const rowRe = new Float64Array(size);
    const rowIm = new Float64Array(size);
    for (let y = 0; y < size; y += 1) {
      const off = y * size;
      for (let x = 0; x < size; x += 1) {
        rowRe[x] = re[off + x];
        rowIm[x] = im[off + x];
      }
      fft1d(rowRe, rowIm, inverse);
      for (let x = 0; x < size; x += 1) {
        re[off + x] = rowRe[x];
        im[off + x] = rowIm[x];
      }
    }

    const colRe = new Float64Array(size);
    const colIm = new Float64Array(size);
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) {
        const i = y * size + x;
        colRe[y] = re[i];
        colIm[y] = im[i];
      }
      fft1d(colRe, colIm, inverse);
      for (let y = 0; y < size; y += 1) {
        const i = y * size + x;
        re[i] = colRe[y];
        im[i] = colIm[y];
      }
    }
  }

  function spectrum(gray, size = SIZE) {
    const re = new Float64Array(gray);
    const im = new Float64Array(size * size);
    fft2(re, im, size, false);
    return { re, im };
  }

  function phaseMatch(spec, carriers, refs, size = SIZE) {
    if (!Array.isArray(refs) || !refs.length) return 0;
    let sum = 0;
    let count = 0;
    const n = Math.min(carriers.length, refs.length);
    for (let i = 0; i < n; i += 1) {
      const [fy, fx] = carriers[i];
      const index = mod(fy, size) * size + mod(fx, size);
      const phase = Math.atan2(spec.im[index], spec.re[index]);
      const diff = Math.abs(wrapAngle(phase - refs[i]));
      sum += 1 - diff / Math.PI;
      count += 1;
    }
    return count ? sum / count : 0;
  }

  function detectGray(gray, size = SIZE) {
    const spec = spectrum(gray, size);
    const dark = phaseMatch(spec, DARK, DATA.darkRefPhases, size);
    const white = phaseMatch(spec, WHITE, DATA.whiteRefPhases, size);
    const bestSet = dark >= white ? 'dark' : 'white';
    const phaseMatchValue = Math.max(dark, white);
    const confidence = sigmoid(20 * (phaseMatchValue - 0.78));
    return {
      detected: phaseMatchValue >= THRESHOLD,
      confidence,
      phaseMatch: phaseMatchValue,
      darkPhaseMatch: dark,
      whitePhaseMatch: white,
      bestSet,
      spectrum: spec
    };
  }

  function imageDataToCanvas(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d', { willReadFrequently: true }).putImageData(imageData, 0, 0);
    return canvas;
  }

  function gray512(imageData) {
    const source = imageDataToCanvas(imageData);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const gray = new Float64Array(SIZE * SIZE);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p += 1) {
      gray[p] = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    }
    return gray;
  }

  function detect(imageData) {
    const result = detectGray(gray512(imageData), SIZE);
    delete result.spectrum;
    return result;
  }

  function carrierRefMap(carriers, refs) {
    const map = new Map();
    const n = Math.min(carriers.length, Array.isArray(refs) ? refs.length : 0);
    for (let i = 0; i < n; i += 1) map.set(`${carriers[i][0]},${carriers[i][1]}`, refs[i]);
    return map;
  }

  const DARK_REFS = carrierRefMap(DARK, DATA.darkRefPhases);
  const WHITE_REFS = carrierRefMap(WHITE, DATA.whiteRefPhases);

  function isRepresentative(fy, fx) {
    return fy > 0 || (fy === 0 && fx > 0);
  }

  function addPhaseScrambleDelta(deltaRe, deltaIm, spec, carriers, refMap, shift, setGain = 1) {
    for (const [fy, fx] of carriers) {
      if (!isRepresentative(fy, fx)) continue;
      const ref = refMap.get(`${fy},${fx}`);
      if (!Number.isFinite(ref)) continue;
      const y = mod(fy, SIZE);
      const x = mod(fx, SIZE);
      const index = y * SIZE + x;
      const currentRe = spec.re[index];
      const currentIm = spec.im[index];
      const magnitude = Math.hypot(currentRe, currentIm);
      if (!(magnitude > 0)) continue;

      const direction = ((Math.abs(fy * 31 + fx * 17) & 1) ? 1 : -1);
      const targetPhase = ref + direction * shift;
      const targetRe = magnitude * Math.cos(targetPhase);
      const targetIm = magnitude * Math.sin(targetPhase);
      const dRe = (targetRe - currentRe) * setGain;
      const dIm = (targetIm - currentIm) * setGain;
      deltaRe[index] += dRe;
      deltaIm[index] += dIm;

      const cy = mod(-fy, SIZE);
      const cx = mod(-fx, SIZE);
      const cIndex = cy * SIZE + cx;
      deltaRe[cIndex] += dRe;
      deltaIm[cIndex] -= dIm;
    }
  }

  function buildScramblePattern(imageData, options = {}) {
    const gray = gray512(imageData);
    const analysis = detectGray(gray, SIZE);
    const deltaRe = new Float64Array(SIZE * SIZE);
    const deltaIm = new Float64Array(SIZE * SIZE);
    const shift = options.shift || Math.PI * 0.72;

    if (options.allSets || analysis.bestSet === 'dark') {
      addPhaseScrambleDelta(deltaRe, deltaIm, analysis.spectrum, DARK, DARK_REFS, shift, 1);
    }
    if (options.allSets || analysis.bestSet === 'white') {
      addPhaseScrambleDelta(deltaRe, deltaIm, analysis.spectrum, WHITE, WHITE_REFS, shift, 1);
    }

    fft2(deltaRe, deltaIm, SIZE, true);
    let maxAbs = 0;
    for (let i = 0; i < deltaRe.length; i += 1) maxAbs = Math.max(maxAbs, Math.abs(deltaRe[i]));
    const maxAmplitude = options.maxAmplitude || 3;
    const scale = maxAbs > maxAmplitude ? maxAmplitude / maxAbs : 1;
    if (scale !== 1) for (let i = 0; i < deltaRe.length; i += 1) deltaRe[i] *= scale;
    return { pattern: deltaRe, analysis };
  }

  function bilinearPattern(pattern, x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(SIZE - 1, x0 + 1);
    const y1 = Math.min(SIZE - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    const a = pattern[y0 * SIZE + x0];
    const b = pattern[y0 * SIZE + x1];
    const c = pattern[y1 * SIZE + x0];
    const d = pattern[y1 * SIZE + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  function hashNoise(x, y, seed) {
    let v = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    v = (v ^ (v >>> 13)) * 1274126177;
    return ((v ^ (v >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  }

  function applyScramblePattern(imageData, pattern, options = {}) {
    const out = new Uint8ClampedArray(imageData.data);
    const width = imageData.width;
    const height = imageData.height;
    const noise = options.noise || 0;
    const seed = options.seed || 1;
    for (let y = 0; y < height; y += 1) {
      const py = height === 1 ? 0 : y * (SIZE - 1) / (height - 1);
      for (let x = 0; x < width; x += 1) {
        const px = width === 1 ? 0 : x * (SIZE - 1) / (width - 1);
        const p = bilinearPattern(pattern, px, py);
        const n = noise ? hashNoise(x, y, seed) * noise : 0;
        const delta = p + n;
        const i = (y * width + x) * 4;
        out[i] = clampByte(out[i] + delta);
        out[i + 1] = clampByte(out[i + 1] + delta);
        out[i + 2] = clampByte(out[i + 2] + delta);
      }
    }
    return new ImageData(out, width, height);
  }

  function resample(imageData, ratio) {
    const source = imageDataToCanvas(imageData);
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(imageData.width * ratio));
    small.height = Math.max(1, Math.round(imageData.height * ratio));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, 0, 0, small.width, small.height);

    const output = document.createElement('canvas');
    output.width = imageData.width;
    output.height = imageData.height;
    const octx = output.getContext('2d', { willReadFrequently: true });
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(small, 0, 0, output.width, output.height);
    return octx.getImageData(0, 0, output.width, output.height);
  }

  async function jpegRoundTrip(imageData, quality) {
    const canvas = imageDataToCanvas(imageData);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('JPEG encoding failed')), 'image/jpeg', quality);
    });
    const bitmap = await createImageBitmap(blob);
    const output = document.createElement('canvas');
    output.width = imageData.width;
    output.height = imageData.height;
    const ctx = output.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, output.width, output.height);
    bitmap.close?.();
    return ctx.getImageData(0, 0, output.width, output.height);
  }

  async function disruptionPass(imageData, options) {
    const { pattern } = buildScramblePattern(imageData, options);
    let out = applyScramblePattern(imageData, pattern, options);
    if (options.squeeze) out = resample(out, options.squeeze);
    if (options.jpeg) out = await jpegRoundTrip(out, options.jpeg);
    return out;
  }

  async function process(imageData) {
    const before = detect(imageData);
    if (!before.detected) {
      return { output: imageData, before, after: before, passes: 0, removed: false };
    }

    let output = await disruptionPass(imageData, {
      shift: Math.PI * 0.76,
      maxAmplitude: 3.2,
      noise: 0.28,
      seed: 11,
      squeeze: 0.94,
      allSets: false
    });
    let after = detect(output);
    let passes = 1;

    if (after.detected) {
      output = await disruptionPass(output, {
        shift: Math.PI * 0.92,
        maxAmplitude: 5.5,
        noise: 0.55,
        seed: 29,
        squeeze: 0.88,
        jpeg: 0.90,
        allSets: true
      });
      after = detect(output);
      passes = 2;
    }

    if (after.detected) {
      output = await disruptionPass(output, {
        shift: Math.PI,
        maxAmplitude: 7.5,
        noise: 0.85,
        seed: 47,
        squeeze: 0.82,
        jpeg: 0.86,
        allSets: true
      });
      after = detect(output);
      passes = 3;
    }

    if (after.detected) {
      output = await disruptionPass(output, {
        shift: Math.PI * 0.83,
        maxAmplitude: 9.5,
        noise: 1.15,
        seed: 71,
        squeeze: 0.74,
        jpeg: 0.82,
        allSets: true
      });
      after = detect(output);
      passes = 4;
    }

    if (after.detected) {
      output = await disruptionPass(output, {
        shift: Math.PI * 0.67,
        maxAmplitude: 12,
        noise: 1.6,
        seed: 97,
        squeeze: 0.66,
        jpeg: 0.76,
        allSets: true
      });
      after = detect(output);
      passes = 5;
    }

    return { output, before, after, passes, removed: before.detected && !after.detected };
  }

  globalThis.SynthIDToolkit = {
    detect,
    process,
    _math: { fft1d, fft2, detectGray, phaseMatch, DARK, WHITE, THRESHOLD }
  };
})();
