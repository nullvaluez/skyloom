// A z11 Mercator cell contains 128 samples and a one-sample halo on each
// side. Neighbouring tiles evaluate exactly the same geographic samples.
export const CITY_HEIGHT_Z = 11;
export const CITY_HEIGHT_SIZE = 128;
export const CITY_HEIGHT_PAD = CITY_HEIGHT_SIZE + 2;
export const CITY_HEIGHT_BYTES = CITY_HEIGHT_PAD ** 2;
export const CITY_HEIGHT_TILES = 2 ** CITY_HEIGHT_Z;

export function decodeCityHeight(code) {
  return (code / 16) ** 2;
}
