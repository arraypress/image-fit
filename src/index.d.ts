/**
 * @arraypress/image-fit — TypeScript definitions.
 */

/** What the fitted picture must be. */
export interface FitRules {
  /** The types that can be chosen. Default `['image/jpeg', 'image/png', 'image/webp']`. */
  accept?: string[];
  /** The biggest picture that can be chosen, in bytes. Default `Infinity`. */
  maxInputBytes?: number;
  /** The most the fitted picture may be, in bytes. */
  maxBytes: number;
  /** The longest side it may have, in pixels. Default `Infinity`. */
  maxSide?: number;
  /** The JPEG qualities tried in turn. Default `[0.88, 0.78, 0.68]`. */
  qualities?: number[];
  /** How much smaller each round is drawn when none fit. Default `0.8`. */
  shrink?: number;
  /** How many rounds before giving up. Default `8`. */
  tries?: number;
}

/**
 * Why a picture can't be fitted: a type not in `accept`, a size over
 * `maxInputBytes`, one that won't decode, one the browser can't redraw,
 * or one that won't shrink to `maxBytes`.
 */
export type FitFailure = 'type' | 'size' | 'unreadable' | 'redraw' | 'shrink';

/**
 * A picture that can't be fitted. The message is a short English
 * default; translate by `reason`.
 */
export class ImageFitError extends Error {
  constructor(reason: FitFailure, message?: string);
  name: 'ImageFitError';
  reason: FitFailure;
}

/**
 * A chosen picture, fitted to the rules: the file itself when it's
 * already a JPEG or PNG within `maxBytes` and `maxSide`; otherwise a PNG
 * (when that fits, and it wasn't a JPEG) or a JPEG, redrawn smaller until
 * it fits. Rejects with an `ImageFitError` when it can't.
 */
export function fitImage(file: Blob & { type: string; size: number }, rules: FitRules): Promise<Blob>;
