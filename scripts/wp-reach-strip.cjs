/** WORLD PASS C (REACH) round 2: frames two to a row (left, right, left, right, ...) at 800 x 450 each.
 *   node scripts/wp-reach-strip.cjs <out.jpg> <a.png> <b.png> [<c.png> <d.png> ...]
 */
const sharp=require('sharp');const out=process.argv[2];const files=process.argv.slice(3);
(async()=>{const W=800,H=450;const rows=files.length/2;const comp=[];for(let i=0;i<files.length;i++){const b=await sharp(files[i]).resize(W,H).toBuffer();comp.push({input:b,left:(i%2)*(W+4),top:Math.floor(i/2)*(H+4)});}
await sharp({create:{width:W*2+4,height:rows*(H+4),channels:3,background:'#000'}}).composite(comp).jpeg({quality:85}).toFile(out);})();
