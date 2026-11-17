/**
 * World Pass C (REACH), round 2b: the far ring's ground-photo worker. Stream C
 * owns this file. Created only by sat-stand-in-photo.js createStandInPhotos,
 * which the skyline engine builds only while the stand-ins are on. Fetches and
 * decodes one group's photo off the main thread and returns the de-lit albedo
 * (transferred).
 */
import { loadPhoto } from './sat-stand-in-photo-core';

self.onmessage = async ({ data }) => {
  const { id, e, sub, cfg } = data;
  let photo = null;
  try {
    photo = await loadPhoto(e, sub, cfg);
  } catch {
    photo = null;
  }
  if (photo) self.postMessage({ id, alb: photo.alb, n: photo.n }, [photo.alb.buffer]);
  else self.postMessage({ id, alb: null, n: 0 });
};
