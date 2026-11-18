// A z11 Mercator cell contains 128 samples and a one-sample halo on each
// side. Neighbouring tiles evaluate exactly the same geographic samples.
export const CITY_HEIGHT_Z = 11;
export const CITY_HEIGHT_SIZE = 128;
export const CITY_HEIGHT_PAD = CITY_HEIGHT_SIZE + 2;
export const CITY_HEIGHT_BYTES = CITY_HEIGHT_PAD ** 2;
export const CITY_HEIGHT_TILES = 2 ** CITY_HEIGHT_Z;

// The three surface bands occupy the original 1024 x 1536 rectangle. Append
// two rows of eight padded height tiles to the SAME appearance texture.
// Eight columns add just 16 texels to its width. Both dimensions fit WebGL2's
// minimum 2048 texture limit, and Ultra keeps its original sixteen samplers.
export const CITY_HEIGHT_LAYOUT = Object.freeze({
  columns: 8, top: 1536, width: 8 * CITY_HEIGHT_PAD, height: 1536 + 2 * CITY_HEIGHT_PAD,
});

export function decodeCityHeight(code) {
  return (code / 16) ** 2;
}
