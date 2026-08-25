# Watermark Toolkit

A small, privacy-first web tool for removing the **visible Gemini diamond watermark** from original Gemini images. Processing is performed entirely with Canvas APIs in the browser: the image is never uploaded to the Worker or any third-party service.

## Live architecture

Cloudflare Workers Static Assets serves `public/`. There is no image-processing backend. `public/app.js` loads local alpha masks and applies reverse alpha blending per RGB channel:

`original = (watermarked - alpha * 255) / (1 - alpha)`

The app supports Gemini 3.5 36 px, Gemini 3.6 48 px, and large-output 96 px geometry. It automatically searches around known bottom-right geometry and also provides a manual click fallback for unusual placement.

## Development

```bash
npm test
npm install
npm run dev
```

## Deployment

```bash
npm install
npm run deploy
```

Cloudflare configuration is in `wrangler.jsonc`. The production Worker is named `watermark-toolkit`.

## CI/CD

`.github/workflows/deploy.yml` runs checks and deploys every push to `main` using `cloudflare/wrangler-action@v4` and Wrangler 4.125.0. The repository needs one Actions secret:

- `CLOUDFLARE_API_TOKEN`

The token must have permission to deploy Workers Scripts for the target account. Never commit the token itself.

## Privacy

- no upload endpoint
- no analytics
- no cookies or local storage
- no runtime CDN dependencies
- local PNG/JPEG/WebP decoding and PNG export

This project targets the visible overlay only. It does not claim to remove or verify invisible provenance signals such as SynthID.

## Credits and license

Application code is MIT licensed. Calibrated Gemini alpha-mask assets are redistributed under their upstream MIT license; see `THIRD_PARTY_NOTICES.md`.
