"""Download the open-licensed inputs the trailer pipeline needs into TRAILER_WORK:
Archivo (expanded), JetBrains Mono and Inter from Google Fonts (SIL OFL), and
Natural Earth 1:50m land / coastline / populated places (public domain)."""
import os
import re
import urllib.request
from paths import FONTS, GEO

CSS = ('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,200;125,300;125,500;125,800;125,900'
       '&family=JetBrains+Mono:wght@400;500&family=Inter:wght@400&display=swap')
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'


def get(url, ua='Mozilla/4.0'):
    req = urllib.request.Request(url, headers={'User-Agent': ua})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


os.makedirs(FONTS, exist_ok=True)
os.makedirs(GEO, exist_ok=True)
css = get(CSS).decode()
for block in re.findall(r'@font-face\s*{([^}]*)}', css):
    fam = re.search(r"font-family: '([^']+)'", block).group(1).replace(' ', '')
    w = re.search(r'font-weight: (\d+)', block).group(1)
    st = re.search(r'font-stretch: ([^;]+)', block)
    name = f"{fam}-{w}{'-expanded' if st and st.group(1).strip() != '100%' else ''}.ttf"
    url = re.search(r'url\(([^)]+)\)', block).group(1)
    open(os.path.join(FONTS, name), 'wb').write(get(url))
    print('font', name)
for f in ('ne_50m_land', 'ne_50m_coastline', 'ne_50m_populated_places_simple'):
    open(os.path.join(GEO, f + '.geojson'), 'wb').write(get(NE + f + '.geojson'))
    print('geo', f)
