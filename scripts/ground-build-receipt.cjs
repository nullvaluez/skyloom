/* Bind the requested static receipt to the application document that loaded.
 * Parse inert Next JSON only; never evaluate inline scripts from the page. */
function validateReceipt(receipt,id){
  if(!receipt||receipt.buildId!==id||!/^[a-f0-9]{64}$/.test(receipt.sourceSha256??''))throw Error('Served build identity mismatch');
  return receipt;
}
function documentIdentity(html){
  const ids=new Set(),chunks=[],scripts=[];
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    const [,attrs,body]=match;
    const src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if(src)scripts.push(src[1]);
    if(/\bid\s*=\s*["']__NEXT_DATA__["']/i.test(attrs)){
      const data=JSON.parse(body);if(typeof data.buildId==='string')ids.add(data.buildId);
    }
    const flight=/^\s*self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/.exec(body);
    if(flight){const row=JSON.parse(flight[1]);if(row[0]===1&&typeof row[1]==='string')chunks.push(row[1]);}
  }
  for(const line of chunks.join('').split('\n')){
    if(!line.startsWith('0:{'))continue;
    const root=JSON.parse(line.slice(2));if(typeof root.b==='string')ids.add(root.b);
  }
  if(ids.size!==1)throw Error('Loaded document build identity unavailable or ambiguous');
  return {buildId:[...ids][0],method:'next-document-json',scriptSrcs:[...new Set(scripts)]};
}
function bindDocument(receipt,html,documentUrl,expectedUrl){
  if(new URL(documentUrl).origin!==new URL(expectedUrl).origin)throw Error('Loaded document origin differs from requested app');
  const document=documentIdentity(html);
  if(document.buildId!==receipt.buildId)throw Error('Loaded document build differs from served receipt');
  return {...receipt,document:{...document,url:documentUrl}};
}
async function groundBuildReceipt(page,url,id){
  if(!id)return null;
  const endpoint=`${new URL(url).origin}/_next/static/${encodeURIComponent(id)}/ground-source.json`;
  const response=await page.request.get(endpoint);
  if(!response.ok())throw Error(`Served build receipt unavailable (${response.status()})`);
  const receipt=validateReceipt(await response.json(),id);
  return bindDocument(receipt,await page.content(),page.url(),url);
}
module.exports=groundBuildReceipt;
Object.assign(module.exports,{validateReceipt,documentIdentity,bindDocument});
