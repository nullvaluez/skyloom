/** WORLD PASS C (REACH) round 2: the same rectangle of two frames side by side, nearest-neighbour zoomed.
 *   node scripts/wp-reach-zoom.cjs <left.png> <right.png> <out.jpg> <left> <top> <width> <height> [scale=2]
 */
const sharp=require('sharp');const [a,b,out,l,t,w,h,s]=process.argv.slice(2);
(async()=>{const S=+s||2;const ex={left:+l,top:+t,width:+w,height:+h};const A=await sharp(a).extract(ex).resize(w*S,h*S,{kernel:'nearest'}).toBuffer();const B=await sharp(b).extract(ex).resize(w*S,h*S,{kernel:'nearest'}).toBuffer();
await sharp({create:{width:w*S*2+6,height:h*S,channels:3,background:'#ff00ff'}}).composite([{input:A,top:0,left:0},{input:B,top:0,left:w*S+6}]).jpeg({quality:90}).toFile(out);})();
