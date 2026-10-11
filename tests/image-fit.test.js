import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { fitImage, ImageFitError } from '../src/index.js';

// ── Stubs ───────────────────────────────────
//
// Node has no canvas, so the browser's pieces are faked: a picture is any
// object with a type, a size, and the width and height its "bitmap" gets;
// a drawn picture is a real Blob of width × height × a factor bytes (the
// PNG factor, or the JPEG factor × quality), so each test sets what fits.

/** Every draw, in order: its size, type, quality, and whether it was filled white. */
let draws;

/** Bytes per pixel for a drawn PNG, and for a JPEG at quality 1. */
let factors;

/** When set, every canvas gives null (or rejects) instead of a picture. */
let writeFails;

/** How many bitmaps were decoded, and closed. */
let decoded, closed;

/** A chosen picture: what `fitImage` reads, and what the fake bitmap is made from. */
function picture(type, size, width = 100, height = 100) {
  return { type, size, width, height };
}

/** The picture a fake canvas writes, logged in `draws`. */
function written(canvas, type, quality) {
  const factor = type === 'image/png' ? factors.png : factors.jpeg * quality;
  draws.push({ width: canvas.width, height: canvas.height, type, quality, filled: canvas.filled });
  return new Blob([new Uint8Array(Math.round(canvas.width * canvas.height * factor))], { type });
}

/** A fake canvas's 2D context: only what `draw` uses. */
function contextOf(canvas) {
  return {
    fillStyle: '',
    fillRect(x, y, w, h) {
      if (this.fillStyle === '#fff' && w === canvas.width && h === canvas.height) canvas.filled = true;
    },
    drawImage() {},
  };
}

/** A page canvas, as `document.createElement('canvas')` gives. */
function fakeCanvas() {
  const canvas = {
    width: 300,
    height: 150,
    filled: false,
    getContext: (kind) => (kind === '2d' ? contextOf(canvas) : null),
    toBlob: (callback, type, quality) => callback(writeFails ? null : written(canvas, type, quality)),
  };
  return canvas;
}

/** A Worker's canvas. */
class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.filled = false;
  }
  getContext(kind) {
    return kind === '2d' ? contextOf(this) : null;
  }
  async convertToBlob({ type, quality } = {}) {
    if (writeFails) throw new DOMException('Nope.', 'EncodingError');
    return written(this, type, quality);
  }
}

/** Decode a picture: its width and height, or a rejection for one marked `broken`. */
async function fakeCreateImageBitmap(file) {
  if (file.broken) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
  decoded++;
  return { width: file.width, height: file.height, close: () => void closed++ };
}

const NAMES = ['createImageBitmap', 'document', 'OffscreenCanvas'];
const originals = Object.fromEntries(NAMES.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));

/** Put `value` at `globalThis[name]`, or (undefined) take it away. */
function install(name, value) {
  if (value === undefined) delete globalThis[name];
  else Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

beforeEach(() => {
  draws = [];
  factors = { png: 1, jpeg: 1 };
  writeFails = false;
  decoded = 0;
  closed = 0;
  install('createImageBitmap', fakeCreateImageBitmap);
  install('document', { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) });
  install('OffscreenCanvas', undefined);
});

after(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

/** Assert that `promise` rejects with an `ImageFitError` for `reason`. */
async function rejectsFor(promise, reason) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ImageFitError);
    assert.equal(error.reason, reason);
    return true;
  });
}

// ── ImageFitError ───────────────────────────

describe('ImageFitError', () => {
  it('is an Error with a reason and a short English default message', () => {
    const error = new ImageFitError('shrink');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'ImageFitError');
    assert.equal(error.reason, 'shrink');
    assert.equal(error.message, "That image won't shrink enough.");
  });

  it('takes a message of your own', () => {
    assert.equal(new ImageFitError('type', 'Nur JPEG, PNG oder WebP.').message, 'Nur JPEG, PNG oder WebP.');
  });
});

// ── What can be chosen ──────────────────────

describe('fitImage — what can be chosen', () => {
  it('rejects a type not accepted, before decoding', async () => {
    await rejectsFor(fitImage(picture('image/gif', 10), { maxBytes: 1000 }), 'type');
    assert.equal(decoded, 0);
  });

  it('accepts what the rules say', async () => {
    const rules = { accept: ['image/gif'], maxBytes: 100_000 };
    const blob = await fitImage(picture('image/gif', 10), rules);
    assert.equal(blob.type, 'image/png'); // a GIF isn't kept as is: redrawn
    await rejectsFor(fitImage(picture('image/jpeg', 10), rules), 'type');
  });

  it('rejects a picture over maxInputBytes, before decoding', async () => {
    await rejectsFor(fitImage(picture('image/png', 2001), { maxInputBytes: 2000, maxBytes: 1000 }), 'size');
    assert.equal(decoded, 0);
  });

  it('rejects one that will not decode', async () => {
    const broken = { ...picture('image/jpeg', 10), broken: true };
    await rejectsFor(fitImage(broken, { maxBytes: 1000 }), 'unreadable');
    assert.equal(draws.length, 0);
  });

  it('wants maxBytes', async () => {
    await assert.rejects(fitImage(picture('image/png', 10), {}), TypeError);
    await assert.rejects(fitImage(picture('image/png', 10), { maxBytes: 0 }), TypeError);
  });
});

// ── Already fine ────────────────────────────

describe('fitImage — already fine', () => {
  it('returns a JPEG within the rules as is: the same object, decoded once, not drawn', async () => {
    const file = Object.assign(new File([new Uint8Array(500)], 'photo.jpg', { type: 'image/jpeg' }), {
      width: 100,
      height: 100,
    });
    assert.equal(await fitImage(file, { maxBytes: 500, maxSide: 100 }), file);
    assert.equal(decoded, 1);
    assert.equal(closed, 1);
    assert.equal(draws.length, 0);
  });

  it('returns a PNG within the rules as is', async () => {
    const file = picture('image/png', 999);
    assert.equal(await fitImage(file, { maxBytes: 1000 }), file);
  });

  it('redraws one whose longest side is over maxSide, scaled down to it', async () => {
    const blob = await fitImage(picture('image/png', 10, 200, 100), { maxBytes: 100_000, maxSide: 100 });
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(draws, [{ width: 100, height: 50, type: 'image/png', quality: undefined, filled: false }]);
  });

  it('redraws one over maxBytes', async () => {
    const blob = await fitImage(picture('image/png', 50_000), { maxBytes: 20_000 });
    assert.equal(blob.type, 'image/png');
    assert.equal(blob.size, 10_000); // 100 × 100 at full size
  });

  it('never keeps a WebP as is: a type the output can be', async () => {
    const blob = await fitImage(picture('image/webp', 10), { maxBytes: 100_000 });
    assert.equal(blob.type, 'image/png');
    assert.equal(draws.length, 1);
  });
});

// ── Redrawn ─────────────────────────────────

describe('fitImage — redrawn', () => {
  it('stays a PNG when that fits (keeping transparency)', async () => {
    const blob = await fitImage(picture('image/png', 50_000), { maxBytes: 10_000 });
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(draws.map((d) => d.type), ['image/png']);
  });

  it('falls to a JPEG on a white background when the PNG is too big', async () => {
    factors.png = 3;
    const blob = await fitImage(picture('image/png', 50_000), { maxBytes: 9000 });
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(draws, [
      { width: 100, height: 100, type: 'image/png', quality: undefined, filled: false },
      { width: 100, height: 100, type: 'image/jpeg', quality: 0.88, filled: true },
    ]);
  });

  it('never tries a PNG for a JPEG', async () => {
    const blob = await fitImage(picture('image/jpeg', 50_000), { maxBytes: 9000 });
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(draws.map((d) => d.type), ['image/jpeg']);
  });

  it('tries each quality in turn', async () => {
    const blob = await fitImage(picture('image/jpeg', 50_000), { maxBytes: 7000 });
    assert.deepEqual(draws.map((d) => d.quality), [0.88, 0.78, 0.68]);
    assert.equal(blob.size, 6800);
  });

  it('takes its own qualities', async () => {
    await fitImage(picture('image/jpeg', 50_000), { maxBytes: 5000, qualities: [0.9, 0.5] });
    assert.deepEqual(draws.map((d) => d.quality), [0.9, 0.5]);
  });

  it('shrinks over rounds when no quality fits', async () => {
    // 100 × 100: 8800 / 7800 / 6800, then 80 × 80: 5632 / 4992 / 4352, then 64 × 64: 3604 / 3195 / 2785.
    const blob = await fitImage(picture('image/jpeg', 50_000), { maxBytes: 3000 });
    assert.equal(draws.length, 9);
    assert.deepEqual(draws.at(-1), { width: 64, height: 64, type: 'image/jpeg', quality: 0.68, filled: true });
    assert.equal(blob.size, 2785);
  });

  it('shrinks by its own factor', async () => {
    await fitImage(picture('image/jpeg', 50_000), { maxBytes: 2000, shrink: 0.5, qualities: [1] });
    assert.deepEqual(draws.map((d) => d.width), [100, 50, 25]);
  });

  it('gives up (shrink) after the rounds, and closes the bitmap', async () => {
    await rejectsFor(fitImage(picture('image/png', 50_000), { maxBytes: 1 }), 'shrink');
    assert.equal(draws.length, 1 + 8 * 3); // one PNG, then eight rounds of three JPEGs
    assert.equal(closed, 1);
  });

  it('gives up after its own number of rounds', async () => {
    await rejectsFor(fitImage(picture('image/jpeg', 50_000), { maxBytes: 1, tries: 2 }), 'shrink');
    assert.equal(draws.length, 2 * 3);
  });

  it('never draws smaller than 1 × 1', async () => {
    await rejectsFor(fitImage(picture('image/jpeg', 50_000, 2, 1), { maxBytes: 0.1, shrink: 0.1, tries: 3 }), 'shrink');
    assert.ok(draws.every((d) => d.width >= 1 && d.height >= 1));
  });

  it('rejects (redraw) when the canvas gives null, and closes the bitmap', async () => {
    writeFails = true;
    await rejectsFor(fitImage(picture('image/png', 50_000), { maxBytes: 1000 }), 'redraw');
    assert.equal(closed, 1);
  });

  it("keeps FlareCart's numbers: a 4000 × 3000 PNG to 512 KB, 1600 on the longest side", async () => {
    factors = { png: 1, jpeg: 0.4 };
    const rules = { maxInputBytes: 2 * 1024 * 1024, maxBytes: 512_000, maxSide: 1600 };
    const blob = await fitImage(picture('image/png', 1_500_000, 4000, 3000), rules);
    // 1600 × 1200: PNG 1,920,000, JPEG 675,840 / 599,040 / 522,240; then 1280 × 960 at 0.88: 432,538.
    assert.deepEqual(draws.map((d) => [d.type, d.width, d.height, d.quality]), [
      ['image/png', 1600, 1200, undefined],
      ['image/jpeg', 1600, 1200, 0.88],
      ['image/jpeg', 1600, 1200, 0.78],
      ['image/jpeg', 1600, 1200, 0.68],
      ['image/jpeg', 1280, 960, 0.88],
    ]);
    assert.equal(blob.size, 432_538);
  });
});

// ── In a Worker ─────────────────────────────

describe('fitImage — without a document (a Worker)', () => {
  beforeEach(() => {
    install('document', undefined);
    install('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('draws on an OffscreenCanvas', async () => {
    factors.png = 3;
    const blob = await fitImage(picture('image/webp', 10, 200, 100), { maxBytes: 9000, maxSide: 100 });
    assert.equal(blob.type, 'image/jpeg');
    assert.deepEqual(draws, [
      { width: 100, height: 50, type: 'image/png', quality: undefined, filled: false },
      { width: 100, height: 50, type: 'image/jpeg', quality: 0.88, filled: true },
    ]);
  });

  it('rejects (redraw) when convertToBlob fails', async () => {
    writeFails = true;
    await rejectsFor(fitImage(picture('image/png', 50_000), { maxBytes: 1000 }), 'redraw');
  });
});
