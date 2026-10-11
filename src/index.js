/**
 * @arraypress/image-fit
 *
 * A picture someone chose, made to fit an upload's rules (its types, its
 * size, its longest side) in the browser, before it's sent. A JPEG or PNG
 * that already fits goes as it is; anything else is redrawn on a canvas:
 * as a PNG when that fits (it keeps transparency), else as a JPEG, at
 * lower qualities and then smaller each round, until it does.
 *
 * Zero dependencies. Needs `createImageBitmap` and a canvas: a page's
 * `document`, or an `OffscreenCanvas` in a Worker.
 *
 * @module @arraypress/image-fit
 */

/** @typedef {'type' | 'size' | 'unreadable' | 'redraw' | 'shrink'} FitFailure Why a picture can't be fitted. */

/**
 * @typedef {object} FitRules What the fitted picture must be.
 * @property {string[]} [accept] The types that can be chosen. Default JPEG, PNG and WebP.
 * @property {number} [maxInputBytes] The biggest picture that can be chosen. Default no limit.
 * @property {number} maxBytes The most the fitted picture may be.
 * @property {number} [maxSide] The longest side it may have, in pixels. Default no limit.
 * @property {number[]} [qualities] The JPEG qualities tried in turn. Default 0.88, 0.78, 0.68.
 * @property {number} [shrink] How much smaller each round is drawn when none fit. Default 0.8.
 * @property {number} [tries] How many rounds before giving up. Default 8.
 */

/** The types that can be chosen, unless the rules say. */
const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];

/** The types a fitted picture comes out as, so the ones that can go as they are. */
const KEEP = ['image/jpeg', 'image/png'];

/** The JPEG qualities tried in turn, unless the rules say. */
const QUALITIES = [0.88, 0.78, 0.68];

/** Short English messages, by reason. Callers translate by `reason`. */
const MESSAGES = {
  type: "That type of image can't be used.",
  size: 'That image is too big.',
  unreadable: "That image can't be read.",
  redraw: "That image can't be redrawn.",
  shrink: "That image won't shrink enough.",
};

/** A picture that can't be fitted, with why. */
export class ImageFitError extends Error {
  /**
   * @param {FitFailure} reason Why.
   * @param {string} [message] What to say; a short English default by reason.
   */
  constructor(reason, message = MESSAGES[reason]) {
    super(message);
    this.name = 'ImageFitError';
    /** @type {FitFailure} */
    this.reason = reason;
  }
}

/**
 * A blank canvas: the page's, or an `OffscreenCanvas` where there's no
 * document (a Worker).
 *
 * @param {number} width Its width.
 * @param {number} height Its height.
 * @returns {HTMLCanvasElement | OffscreenCanvas} It.
 */
function canvasOf(width, height) {
  if (typeof document === 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * A canvas's picture, as a type.
 *
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas The canvas.
 * @param {string} type `image/png` or `image/jpeg`.
 * @param {number} [quality] For JPEG.
 * @returns {Promise<Blob | null>} The picture, or null when the browser won't write it.
 */
function blobOf(canvas, type, quality) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Draw a picture at a size, as a type.
 *
 * @param {ImageBitmap} bitmap The picture.
 * @param {number} scale Its size, from 0 to 1.
 * @param {string} type `image/png` or `image/jpeg`.
 * @param {number} [quality] For JPEG.
 * @returns {Promise<Blob>} The picture.
 * @throws {ImageFitError} `redraw`, when the browser can't redraw it.
 */
async function draw(bitmap, scale, type, quality) {
  const canvas = canvasOf(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  if (!context) throw new ImageFitError('redraw');
  if (type === 'image/jpeg') {
    // JPEG has no transparency: what was see-through comes out white, not black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await blobOf(canvas, type, quality);
  if (!blob) throw new ImageFitError('redraw');
  return blob;
}

/**
 * A chosen picture, fitted to the rules.
 *
 * @param {Blob & { type: string, size: number }} file What was chosen (a `File` from an input, say).
 * @param {FitRules} rules What it must be.
 * @returns {Promise<Blob>} The file itself when it already fits; otherwise a PNG or JPEG redrawn to.
 * @throws {ImageFitError} `type` or `size` for a picture that can't be chosen, `unreadable` for one
 *   that won't decode, `redraw` when the browser can't redraw it, `shrink` when it won't fit.
 */
export async function fitImage(file, rules) {
  const {
    accept = ACCEPT,
    maxInputBytes = Infinity,
    maxBytes,
    maxSide = Infinity,
    qualities = QUALITIES,
    shrink = 0.8,
    tries = 8,
  } = rules ?? {};
  if (!(maxBytes > 0)) throw new TypeError('fitImage: rules.maxBytes must be a number above 0');
  if (!accept.includes(file.type)) throw new ImageFitError('type');
  if (file.size > maxInputBytes) throw new ImageFitError('size');

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new ImageFitError('unreadable');
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (KEEP.includes(file.type) && file.size <= maxBytes && longest <= maxSide) return file;

    let scale = Math.min(1, maxSide / longest);
    // A PNG (or WebP, which may be transparent) stays a PNG when it can; otherwise a JPEG, a little smaller each round.
    if (file.type !== 'image/jpeg') {
      const png = await draw(bitmap, scale, 'image/png');
      if (png.size <= maxBytes) return png;
    }
    for (let round = 0; round < tries; round++) {
      for (const quality of qualities) {
        const jpeg = await draw(bitmap, scale, 'image/jpeg', quality);
        if (jpeg.size <= maxBytes) return jpeg;
      }
      scale *= shrink;
    }
    throw new ImageFitError('shrink');
  } finally {
    bitmap.close?.();
  }
}
