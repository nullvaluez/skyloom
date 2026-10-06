/**
 * TRUE EARTH — receives a device report from the diagnostics overlay
 * (`?diag=1` → Send report) and writes it under .graphics-review/device-reports/
 * on the machine running the server: how an iPhone on the LAN hands its
 * numbers to the owner's PC without the clipboard or share sheet, both of
 * which need HTTPS that a LAN dev server does not have.
 *
 * Off in production unless FLY_DEVICE_REPORTS=1, so a deployed build never
 * writes files. Reports are JSON, capped at 512 KB, with a server-chosen name.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
const MAX_BYTES = 512 * 1024;

function enabled() {
  return process.env.NODE_ENV !== 'production' || process.env.FLY_DEVICE_REPORTS === '1';
}

export async function POST(request) {
  if (!enabled()) return new Response('Not found', { status: 404 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return Response.json({ ok: false, error: 'too large' }, { status: 413 });
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: 'not JSON' }, { status: 400 });
  }
  if (report?.schema !== 'skyloom-device-report/1') return Response.json({ ok: false, error: 'unknown schema' }, { status: 400 });
  const slug = String(report?.gpu?.class || 'device').replace(/[^a-z0-9-]/gi, '').slice(0, 16) || 'device';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(process.cwd(), '.graphics-review', 'device-reports');
  const file = path.join(dir, `${stamp}-${slug}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return Response.json({ ok: true, file: path.relative(process.cwd(), file) });
}
