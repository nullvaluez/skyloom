/* Pure final-gate fixtures; no browser or graphics context starts. */
const assert=require('node:assert/strict');
const {captureBudgetChecks}=require('./graphics-capture-budget.cjs');
let passed=0;
function test(name,run){run();passed++;console.log(`PASS ${name}`);}
const audit={contexts:1,created:12,currentBytes:100*1048576,peakBytes:200*1048576,peakComplete:true};
const shot={name:'powell',file:'fixture.png',review:{drawCalls:200,triangles:1000000},textureAudit:audit};
const check=(textureAudit=audit,enabled=true)=>captureBudgetChecks([{...shot,textureAudit}],enabled)[0];
test('observed complete allocation population can satisfy the texture gate',()=>assert.equal(check().pass,true));
test('zero-observation audit cannot certify memory from a true completeness flag',()=>{
  for(const change of [{contexts:0},{created:0},{currentBytes:0},{peakBytes:0}]){
    const result=check({...audit,...change});assert.equal(result.allocationObserved,false);assert.equal(result.pass,false);
  }
});
test('missing, incomplete and nonfinite allocations cannot satisfy the gate',()=>{
  for(const value of [null,{}, {...audit,peakComplete:false},{...audit,peakBytes:NaN},{...audit,currentBytes:Infinity}])assert.equal(check(value).pass,false);
});
test('the peak limit cannot be bypassed by a lower settled population',()=>assert.equal(check({...audit,peakBytes:301*1048576}).pass,false));
test('renderbuffers remain reported separately from the texture-only ceiling',()=>{
  const result=check({...audit,combinedBytes:450*1048576,peakCombinedBytes:500*1048576});
  assert.equal(result.pass,true);assert.equal(result.peakCombinedAllocationBytes,500*1048576);assert.equal(result.textureLimitBytes,300*1048576);
});
test('non-audit capture retains draw/triangle gates without a memory claim',()=>{
  assert.equal(check(null,false).pass,true);assert.equal(check(null,false).allocationObserved,false);
  for(const review of [{drawCalls:376,triangles:1000000},{drawCalls:200,triangles:2000001}])assert.equal(captureBudgetChecks([{...shot,review}],false)[0].pass,false);
  assert.equal(captureBudgetChecks([{...shot,name:'owens',review:{drawCalls:262,triangles:1000000}}],false)[0].pass,false);
});
console.log(`VERIFY: PASS capture budget ${passed}/${passed} Node cases; no GPU claim`);
