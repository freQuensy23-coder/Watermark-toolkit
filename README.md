# Watermark Toolkit

Client-side image metadata editor with optional Gemini visible-watermark removal.

Live: https://watermark-toolkit.pages.dev

## Modes

- **Single** — process one image, compare before/after, download PNG.
- **Bulk** — process multiple images, preview every processed result, and download the results as one ZIP.

## Watermark removal

**Remove watermark** is off by default: images are re-encoded as PNG for metadata editing without applying watermark removal. Enable it for images with a Gemini watermark. The same checkbox applies to Single and Bulk. Changing it reprocesses loaded images from the originals and updates previews and downloads.

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
