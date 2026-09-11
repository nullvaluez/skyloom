/* A harness source hash cannot identify a different directory's served build. */
module.exports=async function groundBuildReceipt(page,url,id){
  if(!id)return null;
  const endpoint=`${new URL(url).origin}/_next/static/${encodeURIComponent(id)}/ground-source.json`;
  const response=await page.request.get(endpoint);
  if(!response.ok())throw Error(`Served build receipt unavailable (${response.status()})`);
  const receipt=await response.json();
  if(receipt.buildId!==id||!/^[a-f0-9]{64}$/.test(receipt.sourceSha256))throw Error('Served build identity mismatch');
  return receipt;
};
