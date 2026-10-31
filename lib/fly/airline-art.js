// Vector masters from Simple Icons 13.21.0 (CC0), plus authored fleet paint.
// See public/licenses/commercial-liveries.md for source and trademark notices.
// Canvas coordinates are normalized; the same artwork feeds player and traffic.
import paths from './airline-mark-paths.json' with { type: 'json' };
import { COMMERCIAL_PAINT } from './fly-constants.js';
import { pinned } from './fly-pins.js';

export const commercialPaintOn = () => pinned(COMMERCIAL_PAINT, '__flyCommercialPaintOverride').enabled === true;
const pathCache = new Map();
function vector(c, id, x, y, size, color) {
  if (!pathCache.has(id)) pathCache.set(id, new Path2D(paths[id]));
  c.save(); c.translate(x, y); c.scale(size / 24, size / 24);
  c.fillStyle = color; c.fill(pathCache.get(id)); c.restore();
}
function shape(c, color, d) { c.fillStyle = color; c.fill(new Path2D(d)); }
function text(c, value, x, y, size, color, max = 225, italic = false) {
  c.fillStyle = color; c.font = `${italic ? 'italic ' : ''}600 ${size}px Arial, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, x, y, max);
}
function fedex(c,x,y,width,height,tail=false){
  c.save();c.translate(x,y);c.scale(width/600,height/180);
  c.font='700 160px Arial, sans-serif';c.textBaseline='middle';c.textAlign='left';
  c.fillStyle=tail?'#ffffff':'#5b287e';c.fillText('Fed',0,95,307);
  c.fillStyle='#ed8b2c';c.fillText('Ex',294,95,220);
  c.restore();
}

/** Opaque full-bleed fin artwork, in a 256-square source space. */
export function drawAirlineTail(c, s, x = 0, y = 0, width = 256, height = width) {
  c.save(); c.translate(x, y); c.scale(width / 256, height / 256);
  c.beginPath(); c.rect(0, 0, 256, 256); c.clip();
  const col = s.colors;
  c.fillStyle = col.fin; c.fillRect(0, 0, 256, 256);
  switch (s.id) {
    case 'delta':
      shape(c, '#e01933', 'M130 39 L56 174 L130 146Z');
      shape(c, '#b9102d', 'M130 39 L130 146 L204 174Z'); break;
    case 'southwest':
      shape(c, '#f6c446', 'M-30 178 Q110 144 280 23 L290 104 Q118 218 -30 232Z');
      shape(c, '#e82336', 'M-30 207 Q114 180 280 69 L290 158 Q118 256 -30 280Z'); break;
    case 'united':
      c.fillStyle = '#b1d7f2'; c.fillRect(19, 17, 218, 218);
      vector(c, 'unitedairlines', 19, 17, 218, '#155ba5'); break;
    case 'american':
      c.fillStyle = '#edf2f7'; c.fillRect(0, 0, 256, 256);
      for (let i = -1; i < 8; i++) {
        const yy = i * 44;
        shape(c, '#c92136', `M0 ${yy} L154 ${yy-38} L154 ${yy-17} L0 ${yy+21}Z`);
        shape(c, i % 2 ? '#1e5fa2' : '#3886c8', `M154 ${yy-38} L280 ${yy-72} L280 ${yy-28} L154 ${yy+6}Z`);
      } break;
    case 'british-airways':
      shape(c, '#f4f5f3', 'M-50 230 Q100 77 302 31 L302 101 Q95 132 -50 286Z');
      shape(c, '#cf1934', 'M-40 256 Q105 103 295 67 L295 103 Q110 142 -40 287Z');
      shape(c, '#d72239', 'M-30 9 Q85 80 211 256 L151 280 Q62 111 -30 67Z');
      shape(c, '#f4f5f3', 'M-30 9 Q94 82 210 250 L194 260 Q76 94 -30 32Z'); break;
    case 'air-france':
      c.fillStyle = '#f7f7f4'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5; i++) shape(c, i === 4 ? '#d51c35' : '#19366a', `M${-50+i*52} 256 L${75+i*52} 0 L${104+i*52} 0 L${-21+i*52} 256Z`);
      break;
    case 'swiss':
      shape(c, '#ffffff', 'M105 64 H151 V106 H193 V152 H151 V194 H105 V152 H63 V106 H105Z'); break;
    case 'emirates':
      shape(c, '#ffffff', 'M0 0H256V256H0Z');
      shape(c, '#168457', 'M-45 119 Q105 70 284 -35 L284 46 Q124 145 -45 191Z');
      shape(c, '#1b2528', 'M-45 230 Q125 187 284 90 L284 168 Q134 256 -45 300Z');
      shape(c, '#cf2434', 'M0 0 H53 V256 H0Z'); break;
    case 'jetblue':
      for (let row = 0; row < 5; row++) for (let i = 0; i < 5; i++) {
        c.fillStyle = ['#143b78','#3b82b6','#80bfd6','#203e76'][(i+row*3)%4];
        c.fillRect(i*57-row%2*28, row*55, 50, 48);
      } break;
    case 'qantas':
      // The supplied vector is a red tail silhouette with a knocked-out kangaroo.
      c.save(); c.translate(35, 33); c.scale(7.7, 7.7);
      shape(c, '#ffffff', 'M0 3.47H4.2L24 20.53H6.6Z');
      c.fillStyle = col.fin; c.fill(new Path2D(paths.qantas)); c.restore(); break;
    case 'turkish':
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(128, 124, 83, 0, Math.PI*2); c.fill();
      vector(c, 'turkishairlines', 45, 41, 166, col.fin); break;
    case 'etihad':
      for (const [color, d] of [
        ['#d6c7a1','M0 0H256L136 104Z'], ['#94784e','M256 0V192L136 104Z'],
        ['#cab282','M0 0L136 104L0 174Z'], ['#e8dfc6','M0 174L136 104L88 256H0Z'],
        ['#ad9060','M136 104L256 192L88 256Z'], ['#594a3b','M256 192V256H88Z'],
      ]) shape(c, color, d); break;
    case 'iberia':
      shape(c, '#edaf27', 'M95 -30 H280 V256 H8Z');
      shape(c, '#cd2634', 'M155 -30 H280 V256 H65Z'); break;
    case 'aer-lingus':
      c.save(); c.translate(128, 129); c.rotate(-.22); c.fillStyle = '#83bf55';
      for (const [cx,cy] of [[0,-34],[-31,12],[31,12]]) { c.beginPath(); c.ellipse(cx,cy,29,33,0,0,Math.PI*2); c.fill(); }
      shape(c, '#83bf55','M-8 16H8Q4 65 31 79L19 87Q-12 65 -8 16Z'); c.restore(); break;
    case 'air-new-zealand':
      c.strokeStyle = '#ffffff'; c.lineWidth = 15; c.lineCap = 'round';
      c.beginPath(); c.moveTo(66, 186); c.bezierCurveTo(193,208,215,76,139,61);
      c.bezierCurveTo(76,48,60,134,115,143); c.bezierCurveTo(152,148,167,102,134,97); c.stroke(); break;
    case 'air-india':
      c.strokeStyle = '#d7ae68'; c.lineWidth = 13;
      c.beginPath(); c.moveTo(57,211); c.lineTo(100,74); c.quadraticCurveTo(128,24,155,74); c.lineTo(200,211); c.stroke();
      c.lineWidth = 7; c.beginPath(); c.moveTo(85,208); c.lineTo(118,91); c.quadraticCurveTo(128,69,138,91); c.lineTo(173,208); c.stroke(); break;
    case 'finnair': text(c, 'F', 128, 125, 157, '#ffffff', 175, true); break;
    case 'sas': text(c, 'SAS', 127, 129, 78, '#ffffff', 218, true); break;
    case 'spirit': text(c, 'spirit', 128, 128, 66, '#202528'); break;
    case 'atlas':
      c.strokeStyle = '#c5a15b'; c.lineWidth = 4; c.beginPath(); c.arc(128,115,72,0,Math.PI*2); c.stroke();
      for (const rx of [26,50]) { c.beginPath(); c.ellipse(128,115,rx,72,0,0,Math.PI*2); c.stroke(); }
      for (const yy of [80,115,150]) { c.beginPath(); c.ellipse(128,yy,65,12,0,0,Math.PI*2); c.stroke(); }
      text(c, 'ATLAS', 128, 214, 29, '#e3c87e'); break;
    case 'cargolux':
      text(c, 'cargolux', 128, 127, 44, '#ffffff');
      for (let i=0;i<3;i++) shape(c,'#ffffff',`M${46+i*54} 172h38v18h-38Z`); break;
    case 'amazon':
      shape(c,'#ffffff','M42 123 Q123 170 213 112 L207 135 Q119 193 42 123Z M185 108L221 105L213 140L206 119Z'); break;
    case 'fedex': fedex(c,22,90,245,78,true); break;
    default: {
      const ids = { 'air-canada':'aircanada', lufthansa:'lufthansa', klm:'klm', qatar:'qatarairways', singapore:'singaporeairlines', 'japan-airlines':'japanairlines', ana:'ana', ryanair:'ryanair', easyjet:'easyjet', fedex:'fedex', ups:'ups', dhl:'dhl' };
      if (ids[s.id]) vector(c, ids[s.id], 44, 36, 168, s.id==='klm' ? '#ffffff' : col.tailInk);
      else text(c, s.code, 128, 128, 63, col.tailInk);
    }
  }
  c.restore();
}

/** Long-form titles use the actual brand vector where available. */
export function drawAirlineTitle(c, s, x, y, width, height) {
  c.save(); c.translate(x, y); c.scale(width / 1024, height / 256);
  const col = s.colors;
  const wordmarks = { jetblue:'jetblue', easyjet:'easyjet', ana:'ana', dhl:'dhl' };
  if (wordmarks[s.id]) {
    c.save(); c.beginPath(); c.rect(0,0,1024,256); c.clip();
    // These vector masters have whitespace above/below the long wordmark.
    vector(c, wordmarks[s.id], 47, -337, 930, col.ink); c.restore();
  } else if (s.id === 'fedex') {
    fedex(c,70,31,1010,202);
  } else {
    text(c, s.marking, 512, 130, s.id==='british-airways'?102:126, col.ink, 970, ['spirit'].includes(s.id));
  }
  if (s.id === 'delta') shape(c,'#cb1935','M12 175L48 68L83 175L48 151Z');
  c.restore();
}
