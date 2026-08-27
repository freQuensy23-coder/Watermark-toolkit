import fs from 'node:fs';

function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Missing patch anchor: ${label}`);
  return text.replace(from, to);
}

let synth = fs.readFileSync('public/synthid.js', 'utf8');
synth = replaceOnce(
  synth,
  `    if (after.detected) {\n      output = await disruptionPass(output, {\n        shift: Math.PI,\n        maxAmplitude: 7.5,\n        noise: 0.85,\n        seed: 47,\n        squeeze: 0.82,\n        jpeg: 0.86,\n        allSets: true\n      });\n      after = detect(output);\n      passes = 3;\n    }\n\n    return { output, before, after, passes, removed: before.detected && !after.detected };\n`,
  `    if (after.detected) {\n      output = await disruptionPass(output, {\n        shift: Math.PI,\n        maxAmplitude: 7.5,\n        noise: 0.85,\n        seed: 47,\n        squeeze: 0.82,\n        jpeg: 0.86,\n        allSets: true\n      });\n      after = detect(output);\n      passes = 3;\n    }\n\n    if (after.detected) {\n      output = await disruptionPass(output, {\n        shift: Math.PI * 0.83,\n        maxAmplitude: 9.5,\n        noise: 1.15,\n        seed: 71,\n        squeeze: 0.74,\n        jpeg: 0.82,\n        allSets: true\n      });\n      after = detect(output);\n      passes = 4;\n    }\n\n    if (after.detected) {\n      output = await disruptionPass(output, {\n        shift: Math.PI * 0.67,\n        maxAmplitude: 12,\n        noise: 1.6,\n        seed: 97,\n        squeeze: 0.66,\n        jpeg: 0.76,\n        allSets: true\n      });\n      after = detect(output);\n      passes = 5;\n    }\n\n    return { output, before, after, passes, removed: before.detected && !after.detected };\n`,
  'extra fallback passes'
);
fs.writeFileSync('public/synthid.js', synth);

let app = fs.readFileSync('public/app.js', 'utf8');
app = replaceOnce(
  app,
  `    singleReady: false,\n    bulk: [],\n`,
  `    singleReady: false,\n    singleSynth: null,\n    bulk: [],\n`,
  'single synth state'
);
app = replaceOnce(
  app,
  `        state.singleReady = true;\n        state.bulk = [];\n        setSinglePreview(result.source, result.output, result.synth);\n`,
  `        state.singleReady = true;\n        state.singleSynth = result.synth;\n        state.bulk = [];\n        setSinglePreview(result.source, result.output, result.synth);\n`,
  'store single synth'
);
app = replaceOnce(
  app,
  `        state.bulk = [];\n        state.bulkSelected = -1;\n        state.singleReady = false;\n`,
  `        state.bulk = [];\n        state.bulkSelected = -1;\n        state.singleReady = false;\n        state.singleSynth = null;\n`,
  'reset single synth in bulk'
);
app = replaceOnce(
  app,
  `    } finally {\n      state.processing = false;\n      downloadButton.disabled = false;\n      fileInput.value = '';\n    }\n`,
  `    } finally {\n      state.processing = false;\n      const synthBlocked = state.mode === 'single'\n        ? Boolean(state.singleSynth?.after?.detected)\n        : state.bulk.some((item) => item.synth?.after?.detected);\n      downloadButton.disabled = synthBlocked;\n      fileInput.value = '';\n    }\n`,
  'block positive exports'
);
app = replaceOnce(
  app,
  `    state.singleReady = false;\n    state.bulk = [];\n`,
  `    state.singleReady = false;\n    state.singleSynth = null;\n    state.bulk = [];\n`,
  'reset mode single synth'
);
app = replaceOnce(
  app,
  `      if (state.mode === 'single') {\n        if (!state.singleReady) return;\n`,
  `      if (state.mode === 'single') {\n        if (!state.singleReady || state.singleSynth?.after?.detected) return;\n`,
  'single download guard'
);
app = replaceOnce(
  app,
  `      } else {\n        if (!state.bulk.length) return;\n`,
  `      } else {\n        if (!state.bulk.length || state.bulk.some((item) => item.synth?.after?.detected)) return;\n`,
  'bulk download guard'
);
fs.writeFileSync('public/app.js', app);

let tests = fs.readFileSync('tests/test.mjs', 'utf8');
if (!tests.includes('maxAmplitude: 12')) {
  tests = replaceOnce(
    tests,
    `assert.match(synthid, /disruptionPass/);\n`,
    `assert.match(synthid, /disruptionPass/);\nassert.match(synthid, /maxAmplitude: 12/);\nassert.match(app, /singleSynth\\?\\.after\\?\\.detected/);\nassert.match(app, /state\\.bulk\\.some\\(\\(item\\) => item\\.synth\\?\\.after\\?\\.detected\\)/);\n`,
    'hardened SynthID tests'
  );
}
fs.writeFileSync('tests/test.mjs', tests);

console.log('SynthID export hardening applied.');
