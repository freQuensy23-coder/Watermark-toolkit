# Watermark Toolkit

Privacy-first web tool for removing the **visible Gemini diamond watermark** from original Gemini images. Processing happens entirely in the browser with Canvas: image bytes are never uploaded to Cloudflare or any third party.

## Live

https://watermark-toolkit.pages.dev

The site runs through Cloudflare's Worker runtime using Pages advanced mode (`public/_worker.js`). The Worker serves the static application through the `ASSETS` binding and adds a runtime verification header; image processing stays client-side.

## How it works

The visible watermark is a white alpha-blended overlay. Using the calibrated per-pixel alpha mask, each RGB channel is recovered with:

`original = (watermarked - alpha * 255) / (1 - alpha)`

Supported profiles are Gemini 3.5 36 px, Gemini 3.6 48 px, and large-output 96 px. Auto mode searches the expected bottom-right geometry; manual positioning is available for unusual placements.

## CI/CD

Every push to `main` runs GitHub Actions CI (`npm test`). The Cloudflare Pages project is connected directly to this GitHub repository and production branch, so Cloudflare automatically builds and deploys `main`. The production build command is `npm test`, with `public/` as the output directory.

Local commands:

```bash
npm install
npm test
npm run dev
npm run deploy
```

## Privacy

- no image upload endpoint
- no analytics
- no cookies or local storage
- no runtime CDN dependencies
- local PNG/JPEG/WebP decoding and PNG export

This tool targets the visible overlay only. It does not remove or claim to remove invisible provenance signals such as SynthID.

## Credits and license

Application code is MIT licensed. Calibrated Gemini alpha-mask assets are redistributed under their upstream MIT license; see `THIRD_PARTY_NOTICES.md`.
