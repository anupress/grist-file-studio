// The small decisions behind the slideshow and the before/after slider, apart from any screen so they can be tested.

export const SPEEDS = [3, 5, 8];
export const DEFAULT_SPEED = 5;

/** The speed to use from whatever was kept: one of SPEEDS, else the default. */
export const speedFrom = (v) => (SPEEDS.includes(Number(v)) ? Number(v) : DEFAULT_SPEED);

/**
 * How long a slideshow stays on a file, in seconds; null for video and audio, which play to their end.
 * A picture gets the chosen time, a document twice as long (there is something to read).
 */
export function dwell(kind, speed) {
  if (kind === 'video' || kind === 'audio') return null;
  return kind === 'image' || kind === 'heic' ? speed : speed * 2;
}

/** The index after i in a list of n, coming round to the first. */
export const nextIndex = (i, n) => (n < 2 ? i : (i + 1) % n);

/** The nearest picture after (dir 1) or before (dir -1) index i, or -1. */
export function nearestImage(files, i, dir) {
  for (let k = i + dir; k >= 0 && k < files.length; k += dir) if (files[k].kind === 'image') return k;
  return -1;
}

/** Where the divider of a before/after slider goes (0 to 100) after a key; null when the key is not one of its keys. */
export function stepDivider(pos, key, big = false) {
  const step = big ? 10 : 2;
  if (key === 'ArrowLeft' || key === 'ArrowDown') return Math.max(0, pos - step);
  if (key === 'ArrowRight' || key === 'ArrowUp') return Math.min(100, pos + step);
  if (key === 'PageDown') return Math.max(0, pos - 10);
  if (key === 'PageUp') return Math.min(100, pos + 10);
  if (key === 'Home') return 0;
  if (key === 'End') return 100;
  return null;
}

/** The divider's place for a pointer at x within a box [left, width]. */
export const dividerAt = (x, left, width) => (width > 0 ? Math.min(100, Math.max(0, ((x - left) / width) * 100)) : 50);
