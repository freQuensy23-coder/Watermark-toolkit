# Watermark Toolkit

Client-side Gemini visible-watermark and SynthID processing toolkit.

Live: https://watermark-toolkit.pages.dev

## Modes

- **Single** — process one image, compare before/after, download PNG.
- **Bulk** — process multiple images, preview every processed result, and download the results as one ZIP.

## SynthID

Single and Bulk run a local phase detector against the published Gemini SynthID carrier families. When detected, the browser automatically applies targeted carrier-phase disruption plus adaptive resampling/compression passes and re-runs the local detector before export. The selected Bulk item shows its SynthID status; thumbnails are marked when SynthID was detected on input. If the local detector is still positive after all fallback passes, export is blocked rather than returning a known-positive file.

Detector reference data and carrier research are derived from **reverse-SynthID by Alosh Denny — github.com/aloshdenny/reverse-SynthID** and are used under that project's Research License. This repository does not include Google's private verifier.

## Metadata

Every output is re-encoded in the browser, so source metadata is removed. `Strip metadata` leaves the output clean. `Set metadata` adds only the selected EXIF fields: location/GPS plus device Make/Model. The default location is Tel Aviv, Israel. Device presets include phones and cameras, with custom Make/Model support.

## Development

```bash
npm install
npm test
npm run dev
```

## CI/CD

Every push to `main` runs tests, obtains a short-lived GitHub OIDC token, triggers the Cloudflare Pages deployment relay, then verifies that both the immutable deployment URL and production alias serve the exact commit SHA through the Worker runtime.

No long-lived Cloudflare deployment credential is stored in GitHub.

## Privacy

Image processing and metadata rewriting happen in the browser. Images are not uploaded to the Worker or third-party services.

## License

Application code is MIT licensed. Watermark mask assets retain their upstream MIT license; see `THIRD_PARTY_NOTICES.md`.
