import { createCityHeightService } from '@/lib/fly/city-height-source.mjs';

export const runtime = 'nodejs';

// One service per server instance: the recent-tile LRU (256 tiles, about
// 4.3 MB) and the four-read pending guard are shared by the single-tile form
// (?v=1&x=&y=, byte-identical to the original route) and the batched form
// (?v=1&tiles=x.y,...; lib/fly/city-height-source.mjs, HORIZON FILL).
const service = createCityHeightService();

export async function GET(request) {
  const { status, headers, body } = await service.handle(new URL(request.url).searchParams);
  return headers ? new Response(body, { status, headers }) : new Response(body, { status });
}
