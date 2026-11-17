/** WORLD PASS C (REACH) round 2: two frames' same band stacked (control on top), for the ledger crops.
 *   node scripts/wp-reach-pair.cjs <top.png> <bottom.png> <out.jpg> [top=300] [height=330]
 */
const sharp=require('sharp');const [a,b,out,top,h]=process.argv.slice(2);
(async()=>{const t=+top||300,hh=+h||330;const A=await sharp(a).extract({left:0,top:t,width:1600,height:hh}).toBuffer();const B=await sharp(b).extract({left:0,top:t,width:1600,height:hh}).toBuffer();
await sharp({create:{width:1600,height:hh*2+6,channels:3,background:'#ff00ff'}}).composite([{input:A,top:0,left:0},{input:B,top:hh+6,left:0}]).jpeg({quality:88}).toFile(out);})();
