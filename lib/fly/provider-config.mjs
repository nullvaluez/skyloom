// Server-only endpoint configuration. Values come from the deployment owner,
// never request parameters; credentials must not use NEXT_PUBLIC_ variables.
export function providerURL(template, values = {}) {
  const text = template.replace(/\{(lat|lon|dist)\}/g, (_, key) => encodeURIComponent(values[key]));
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
  return url;
}

export function observationTime(value) {
  const stamp = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) :
    typeof value === 'string' ? Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + 'Z') : NaN;
  return Number.isFinite(stamp) ? stamp : null;
}
