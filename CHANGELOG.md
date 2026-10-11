# Changelog

All notable changes to `@arraypress/image-fit` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-10-12

### Initial Release

- `fitImage(file, rules)` — a chosen picture, fitted to the rules: the
  file itself when it's a JPEG or PNG within `maxBytes` and `maxSide`;
  otherwise redrawn on a canvas, scaled to `maxSide`, as a PNG when that
  fits (not for a JPEG), else a JPEG on white at each of `qualities`,
  `shrink` times smaller each round for up to `tries` rounds.
- Rules (type `FitRules`): `accept` (default JPEG, PNG, WebP),
  `maxInputBytes` (default no limit), `maxBytes` (required), `maxSide`
  (default no limit), `qualities` (default `[0.88, 0.78, 0.68]`),
  `shrink` (default `0.8`), `tries` (default `8`).
- `ImageFitError` — what it rejects with, `reason` one of `'type'`,
  `'size'`, `'unreadable'`, `'redraw'`, `'shrink'` (type `FitFailure`),
  with a short English message to translate by `reason`.
- Draws on the page's canvas, or an `OffscreenCanvas` where there's no
  `document` (a Worker).

From FlareCart's admin, where product images are fitted to Stripe's
limits before upload. Zero dependencies, ESM-only.
