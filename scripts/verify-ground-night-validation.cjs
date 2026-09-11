/* Node-only receipt/verdict regression tests. No child gate or browser starts. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {parseArgs,buildJobs,validateReceipt,localSource,readEvidence,assessJob,FLASH_GATE_IDS}=require('./ground-night-validation.cjs');
const repo=path.resolve(__dirname,'..');
const tmpBase=fs.realpathSync(os.tmpdir());
const dir=fs.mkdtempSync(path.join(tmpBase,'ground-verdict-'));
const buildId='immutable-build',sourceSha256='a'.repeat(64);
const base={name:'flight',code:0,requiresEvidence:true,buildId,sourceSha256};
const modern={status:'PASS',servedBuild:{buildId,sourceSha256}};
let passed=0,serial=0;
function test(name,fn){fn();passed++;console.log(`PASS ${name}`);}
function file(contents,mtime){const p=path.join(dir,`${serial++}.json`);fs.writeFileSync(p,contents);if(mtime)fs.utimesSync(p,mtime,mtime);return p;}
function status(patch={}){return assessJob({...base,...patch}).status;}
const flashResults=()=>Array.from({length:9},(_,i)=>({n:i+1,pass:true}));
try{
  test('same checkout uses the build stamp hash, including HUD CSS and hooks',()=>{
    const expected=require('./ground-night-source.cjs')(repo),actual=localSource();
    assert.equal(actual.commit,expected.commit);assert.equal(actual.sourceSha256,expected.sourceSha256);
  });
  test('served receipt rejects absent/malformed source hash and wrong build',()=>{
    assert.equal(validateReceipt(modern.servedBuild,buildId),modern.servedBuild);
    for(const receipt of [null,{buildId},{buildId,sourceSha256:'xyz'},{buildId:'other',sourceSha256}])assert.throws(()=>validateReceipt(receipt,buildId),/identity mismatch/);
  });
  test('fresh modern PASS needs its exact served build and source hash',()=>{
    assert.equal(status({evidence:modern}),'PASS');
    assert.equal(status({evidence:{...modern,servedBuild:{buildId:'other',sourceSha256}}}),'BLOCKED');
    assert.equal(status({evidence:{...modern,servedBuild:{buildId,sourceSha256:'b'.repeat(64)}}}),'BLOCKED');
    assert.equal(status({evidence:{status:'PASS'}}),'BLOCKED');
  });
  test('missing declared flash evidence cannot pass on exit zero',()=>{
    const result=readEvidence(path.join(dir,'absent.json'),new Date().toISOString());
    assert.ok(result.evidenceError);assert.equal(status({name:'flash',...result}),'BLOCKED');
  });
  test('stale declared flash evidence cannot reuse a previous green run',()=>{
    const p=file(JSON.stringify({results:[{pass:true}]}),new Date(Date.now()-60000));
    const result=readEvidence(p,new Date().toISOString());
    assert.match(result.evidenceError,/predates/);assert.equal(status({name:'flash',...result}),'BLOCKED');
  });
  test('malformed JSON and wrong JSON shapes cannot pass',()=>{
    for(const contents of ['{','null','[]','true','"PASS"']){
      const startedAt=new Date(Date.now()-1000).toISOString();
      const result=readEvidence(file(contents),startedAt);
      assert.ok(result.evidenceError);assert.equal(status({name:'flash',...result}),'BLOCKED');
    }
  });
  test('fresh parsed flash evidence with all nine passing gate identities is valid',()=>{
    const result=readEvidence(file(JSON.stringify({results:flashResults(),errors:[]})),new Date(Date.now()-1000).toISOString());
    assert.equal(result.evidenceError,undefined);assert.equal(status({name:'flash',...result}),'PASS');
    assert.equal(status({name:'flash',evidence:{results:flashResults().reverse()}}),'PASS');
  });
  test('partial all-true, duplicate, unknown or missing flash identities cannot pass on exit zero',()=>{
    for(const results of [[{n:1,pass:true}],flashResults().slice(0,8),flashResults().map(()=>({n:1,pass:true})),
      flashResults().map(r=>({...r,n:r.n===9?10:r.n})),flashResults().map(()=>({pass:true})),[...flashResults(),{n:10,pass:true}]]){
      assert.equal(status({name:'flash',code:0,evidence:{results,errors:[]}}),'BLOCKED');
    }
  });
  test('expected flash identities match every named assertion in the current child',()=>{
    const source=fs.readFileSync(path.join(__dirname,'immersive-flash-regression.cjs'),'utf8');
    const ids=[...source.matchAll(/^\s+gate\((\d+),/gm)].map(m=>Number(m[1]));
    assert.deepEqual(ids,FLASH_GATE_IDS);
  });
  test('empty/missing/nonboolean flash gate lists remain blocked',()=>{
    for(const evidence of [{},{results:[]},{results:'PASS'},{results:[null]},{results:[{pass:'true'}]}])assert.equal(status({name:'flash',evidence}),'BLOCKED');
  });
  test('flash gate failure or runtime errors remain FAIL even with exit zero',()=>{
    assert.equal(status({name:'flash',evidence:{results:[{pass:true},{pass:false}]}}),'FAIL');
    assert.equal(status({name:'flash',evidence:{results:[{pass:true}],errors:['WebGL error']}}),'FAIL');
  });
  test('unfinished evidence cannot become a completed PASS',()=>{
    assert.equal(status({evidence:{...modern,status:'IN_PROGRESS'}}),'BLOCKED');
    assert.equal(status({name:'flash',evidence:{status:'IN_PROGRESS',results:[{pass:true}]}}),'BLOCKED');
  });
  test('genuine FAIL and BLOCKED child outcomes are preserved',()=>{
    assert.equal(status({code:1,evidenceError:'missing'}),'FAIL');
    assert.equal(status({code:2,evidenceError:'missing'}),'BLOCKED');
    assert.equal(status({evidence:{status:'FAIL'}}),'FAIL');
    assert.equal(status({evidence:{status:'BLOCKED'}}),'BLOCKED');
    assert.equal(status({code:null}),'BLOCKED');assert.equal(status({signal:'SIGTERM',evidence:modern}),'BLOCKED');
  });
  test('steps and pace preserve original exit-code/log verdict contract',()=>{
    for(const name of ['steps','pace']){
      assert.equal(status({name,requiresEvidence:false}),'PASS');
      assert.equal(status({name,requiresEvidence:false,code:1}),'FAIL');
      assert.equal(status({name,requiresEvidence:false,code:2}),'BLOCKED');
    }
  });
  test('job manifest declares flash JSON and excludes JSON for steps/pace',()=>{
    const jobs=buildJobs({url:'http://localhost:3034',buildId,dir});
    assert.equal(jobs.flash.evidence,path.join(dir,'flash/report.json'));
    assert.equal(jobs.steps.evidence,undefined);assert.equal(jobs.pace.evidence,undefined);
    for(const name of ['flight','day','night','clouds','weather'])assert.ok(jobs[name].evidence);
  });
  test('steps manifest records its released governor instead of the flash hold',()=>{
    const jobs=buildJobs({url:'http://localhost:3034',buildId,dir});
    assert.match(jobs.steps.controls.worldPins,/Governor and settle pins are released/);
    assert.doesNotMatch(jobs.steps.controls.worldPins,/governor hold/);
    assert.match(jobs.flash.controls.worldPins,/governor hold/);
  });
  test('arguments cannot silently select empty, duplicated or unknown gates',()=>{
    const valid=['--url=http://localhost:3034',`--build-id=${buildId}`];
    assert.deepEqual(parseArgs(valid).checks,['flight']);
    for(const extra of ['--checks=','--checks=flash,flash','--checks=unknown','--unexpected=true'])assert.throws(()=>parseArgs([...valid,extra]));
  });
  console.log(`VERIFY: PASS ground-night validation ${passed}/${passed} Node cases; no browser/GPU claim`);
}finally{
  // Delete only this test's checked, newly-created directory under the OS temp root.
  const resolved=fs.realpathSync(dir),relative=path.relative(tmpBase,resolved);
  if(!relative.startsWith('ground-verdict-')||relative.includes(path.sep)||path.isAbsolute(relative))throw Error('Unsafe fixture cleanup target');
  fs.rmSync(resolved,{recursive:true,force:true});
}
