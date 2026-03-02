// PDF user space is 72 points/inch. pdf.js viewport scale converts points -> pixels.
export function pxFromInches(inches, scale) {
  return Math.round(inches * 72 * scale);
}
