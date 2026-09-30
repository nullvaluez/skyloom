import sys, json, re, urllib.request, concurrent.futures as cf
B = "https://s3.us-west-2.amazonaws.com/sentinel-cogs"
def ls(prefix):
    out, tok = [], None
    while True:
        u = f"{B}/?list-type=2&prefix={prefix}&delimiter=/" + (f"&continuation-token={urllib.parse.quote(tok)}" if tok else "")
        x = urllib.request.urlopen(u, timeout=30).read().decode()
        out += re.findall(r"<Prefix>([^<]*)</Prefix>", x)[1:]
        m = re.search(r"<NextContinuationToken>([^<]*)</NextContinuationToken>", x)
        if not m: return out
        tok = m.group(1)
import urllib.parse
def scene_info(p):
    name = p.rstrip('/').split('/')[-1]
    try:
        j = json.loads(urllib.request.urlopen(f"{B}/{p}{name}.json", timeout=30).read())
        pr = j.get('properties', {})
        return (pr.get('eo:cloud_cover'), pr.get('s2:nodata_pixel_percentage'), pr.get('datetime'), p)
    except Exception as e:
        return (None, None, None, p)
tile, years, months = sys.argv[1], sys.argv[2].split(','), sys.argv[3].split(',')
utm, band, sq = tile[:2], tile[2], tile[3:]
prefixes = []
for y in years:
    for mo in months:
        prefixes += ls(f"sentinel-s2-l2a-cogs/{int(utm)}/{band}/{sq}/{y}/{int(mo)}/")
with cf.ThreadPoolExecutor(16) as ex:
    res = list(ex.map(scene_info, prefixes))
res = [r for r in res if r[0] is not None]
res.sort(key=lambda r: (r[0] + (r[1] or 0)))
for r in res[:8]: print(tile, r)
