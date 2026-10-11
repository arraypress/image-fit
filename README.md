# @arraypress/image-fit

> Fit a picture someone chose to an upload's rules — its types, its
> size, its longest side — in the browser, before it's sent. One that
> already fits goes as it is; anything else is redrawn on a canvas, as a
> PNG or a JPEG, smaller until it fits.

Zero dependencies. ESM-only. Runs where there's `createImageBitmap` and
a canvas: a page, or a Worker (with `OffscreenCanvas`).

## Install

```bash
npm install @arraypress/image-fit
```

## Why this exists

An API that stores images has limits: a few types, a few hundred KB.
People choose photos straight off a phone — 4000 pixels wide, 3 MB, a
WebP. Telling them to go and resize it themselves loses them. Doing it
on the server means uploading the big one first.

The browser can do it: decode the picture, draw it smaller on a canvas,
write it out as a JPEG. What takes care is *when to stop*: keep a file
that already fits untouched, keep transparency when a PNG will do, and
only then trade quality and size, a step at a time.

This package is that, once.

## Usage

```js
import { fitImage, ImageFitError } from '@arraypress/image-fit';

input.addEventListener('change', async () => {
  const file = input.files[0];
  try {
    const image = await fitImage(file, {
      accept: ['image/jpeg', 'image/png', 'image/webp'], // what can be chosen (the default)
      maxInputBytes: 2 * 1024 * 1024,                    // the biggest that can be chosen
      maxBytes: 512_000,                                 // what the upload takes
      maxSide: 1600,                                     // the longest side it keeps
    });
    const body = new FormData();
    body.append('file', image, file.name);
    await fetch('/upload', { method: 'POST', body });
  } catch (error) {
    if (error instanceof ImageFitError) showError(error.message); // or translate by error.reason
    else throw error;
  }
});
```

## API

### `fitImage(file, rules)`

The picture, fitted to the rules: a `Promise<Blob>`. `file` is any
`Blob` with a `type` — a `File` from an input, a paste, a drop.

In order:

1. A type not in `accept` rejects (`type`); a size over `maxInputBytes`
   rejects (`size`).
2. It's decoded with `createImageBitmap`. One that won't rejects
   (`unreadable`).
3. A JPEG or PNG within `maxBytes` whose longest side is within
   `maxSide` is returned **as is** — the same object, untouched.
4. Otherwise it's redrawn, first scaled to `maxSide` (never up):
   - unless it was a JPEG, as a PNG — transparency kept. Returned if it
     fits `maxBytes`.
   - then as a JPEG on a white background, at each of `qualities` in
     turn. The first that fits is returned.
   - when none fits, drawn at `shrink` times the size and tried again,
     for `tries` rounds in all.
5. One that still won't fit rejects (`shrink`).

What comes back is always a JPEG or a PNG, so a WebP (or any other type
you accept) is always redrawn.

| Rule | Default | |
|---|---|---|
| `accept` | `['image/jpeg', 'image/png', 'image/webp']` | The types that can be chosen. |
| `maxInputBytes` | `Infinity` | The biggest picture that can be chosen. |
| `maxBytes` | *required* | The most the fitted picture may be. |
| `maxSide` | `Infinity` | The longest side it may have, in pixels. |
| `qualities` | `[0.88, 0.78, 0.68]` | The JPEG qualities tried in turn. |
| `shrink` | `0.8` | How much smaller each round is drawn. |
| `tries` | `8` | How many rounds before giving up. |

### `ImageFitError`

What `fitImage` rejects with when a picture can't be fitted. `reason`
says why:

| `reason` | When |
|---|---|
| `'type'` | Its type isn't in `accept`. |
| `'size'` | It's over `maxInputBytes`. |
| `'unreadable'` | It won't decode (not really an image, or a format this browser can't read). |
| `'redraw'` | The browser wouldn't draw or write it (a canvas too big for memory, say). |
| `'shrink'` | It won't get under `maxBytes` in `tries` rounds. |

The `message` is a short English default ("That image is too big.").
For anything people read, translate by `reason`:

```js
const messages = {
  type: 'Choose a JPEG, PNG or WebP.',
  size: 'Choose a picture under 2 MB.',
  unreadable: "That picture can't be opened.",
  redraw: "That picture can't be resized here.",
  shrink: "That picture can't be made small enough.",
};
showError(messages[error.reason]);
```

## In a Worker

Where there's no `document`, it draws on an `OffscreenCanvas` and writes
with `convertToBlob`, so the work can be kept off the page's thread:

```js
// fit.worker.js
import { fitImage } from '@arraypress/image-fit';

self.onmessage = async ({ data: file }) => {
  try {
    self.postMessage({ image: await fitImage(file, { maxBytes: 512_000, maxSide: 1600 }) });
  } catch (error) {
    self.postMessage({ reason: error.reason });
  }
};
```

## TypeScript

Ships with `.d.ts`: `fitImage`, `ImageFitError`, and the types
`FitRules` and `FitFailure`.

```ts
import { fitImage, type FitRules } from '@arraypress/image-fit';

const STRIPE: FitRules = { maxInputBytes: 2 * 1024 * 1024, maxBytes: 512_000, maxSide: 1600 };
const image: Blob = await fitImage(file, STRIPE);
```

## License

MIT
