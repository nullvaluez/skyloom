/* Inert document/receipt fixtures. No network, app, browser or GPU starts. */
const assert=require('node:assert/strict');
const readReceipt=require('./ground-build-receipt.cjs');
const {documentIdentity,bindDocument}=readReceipt;
const receipt={buildId:'current-build',sourceSha256:'a'.repeat(64)};
const url='http://localhost:3036/?graphics=immersive&graphicsReview=1';
const push=value=>`<script>self.__next_f.push(${JSON.stringify([1,value])})</script>`;
const flight=`0:${JSON.stringify({P:null,b:receipt.buildId,f:[]})}\n`;
const html=`<script src="/_next/static/chunks/main-app-abcd.js" async></script>${push(flight)}`;
let passed=0;
function test(name,run){run();passed++;console.log(`PASS ${name}`);}
test('App Router root record binds document and retains script evidence',()=>{
  const result=bindDocument(receipt,html,url,url);assert.equal(result.document.buildId,receipt.buildId);
  assert.deepEqual(result.document.scriptSrcs,['/_next/static/chunks/main-app-abcd.js']);assert.equal(receipt.document,undefined);
});
test('split streamed Flight records parse only after concatenation',()=>assert.equal(documentIdentity(push(flight.slice(0,17))+push(flight.slice(17))).buildId,receipt.buildId));
test('Pages Router document identity is supported without evaluating scripts',()=>assert.equal(documentIdentity(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({buildId:receipt.buildId})}</script>`).buildId,receipt.buildId));
test('matching receipt for another static build cannot identify the loaded app',()=>assert.throws(()=>bindDocument({...receipt,buildId:'old-build'},html,url,url),/document build differs/));
test('missing, ambiguous and non-root identities cannot pass',()=>{
  for(const value of ['',push('1:{"b":"current-build"}\n'),html+push('0:{"b":"other-build"}\n')])assert.throws(()=>documentIdentity(value),/unavailable or ambiguous/);
});
test('executable inline text is never evaluated to manufacture an identity',()=>{
  assert.throws(()=>documentIdentity('<script>self.__next_f.push((globalThis.executed=true,[1,"0:{}"]))</script>'),/unavailable/);
  assert.equal(globalThis.executed,undefined);
});
test('redirected origin and malformed receipt fail closed',()=>{
  assert.throws(()=>bindDocument(receipt,html,'http://localhost:9999/',url),/origin differs/);
  assert.throws(()=>readReceipt.validateReceipt({buildId:receipt.buildId},receipt.buildId),/identity mismatch/);
});
(async()=>{
  let requested;
  const page={request:{get:async endpoint=>{requested=endpoint;return {ok:()=>true,json:async()=>receipt};}},content:async()=>html,url:()=>url};
  const bound=await readReceipt(page,url,receipt.buildId);
  assert.equal(bound.document.buildId,receipt.buildId);assert.equal(requested,`http://localhost:3036/_next/static/${receipt.buildId}/ground-source.json`);
  passed++;console.log('PASS browser helper validates the actual document, not only its requested receipt');
  await assert.rejects(readReceipt({...page,content:async()=>push('0:{"b":"other-build"}\n')},url,receipt.buildId),/document build differs/);
  passed++;console.log('PASS browser helper rejects a stale receipt beside a different loaded app');
  console.log(`VERIFY: PASS ground build receipt ${passed}/${passed} Node cases; no browser/GPU claim`);
})().catch(error=>{console.error(error);process.exitCode=1;});
