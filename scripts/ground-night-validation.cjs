/* Sequential GPU gates only. Importing this module starts nothing.
 * node scripts/ground-night-validation.cjs --url=http://localhost:3034 --build-id=ID --checks=flight
 * Detailed child output stays in per-check files; no assertion is re-baselined.
 */
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {validateReceipt,bindDocument}=require('./ground-build-receipt.cjs');
const repo=path.resolve(__dirname,'..');
// The nine named assertions in immersive-flash-regression.cjs, not a count of
// whatever partial results happen to have been written by an exit-zero child.
const FLASH_GATE_IDS=Object.freeze([1,2,3,4,5,6,7,8,9]);
const defaultsToRestore=['FLY_TILE_FIXTURE','FLY_FIXTURE_DEM_MAXZOOM','FLY_FINALIZE_BUDGET_K','FLY_BOOT_SCALE',
  'FLASH_PIN_OFF','STEP_PIN_OFF','PACE_MAX_STALLS','PACE_MAX_LONG100','PACE_MAX_P99','SECONDS','DSF',
  'STEP_DSF','STEP_N','STEP_LIVE_MS','PACE_RUN_MS','PACE_SETTLE_MS','FLASH_CAPTURE','HEADED','WEATHER'];

function parseArgs(argv){
  const args={};
  for(const arg of argv){
    const match=/^--([^=]+)(?:=(.*))?$/.exec(arg);
    if(!match)throw Error(`Use --name=value arguments: ${arg}`);
    args[match[1]]=match[2]??true;
  }
  if(args.help)return {help:true};
  if(typeof args.url!=='string'||typeof args['build-id']!=='string')throw Error('--url and --build-id are required');
  const target=new URL(args.url);
  if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('--url must be an HTTP(S) app origin without credentials');
  if(target.pathname!=='/'||target.search||target.hash)throw Error('--url must be the app origin, without path, query or fragment');
  const buildId=args['build-id'];
  if(!/^[a-zA-Z0-9_-]+$/.test(buildId))throw Error('Invalid --build-id');
  const checks=(args.checks??'flight').split(',').map(s=>s.trim());
  if(!checks.length||checks.some(k=>!['flight','day','night','clouds','weather','flash','steps','pace'].includes(k)))throw Error('Unknown or empty check');
  if(new Set(checks).size!==checks.length)throw Error('Duplicate checks are not allowed');
  for(const key of Object.keys(args))if(!['url','build-id','checks','output'].includes(key))throw Error(`Unknown option --${key}`);
  return {url:target.origin,buildId,checks,dir:path.resolve(repo,args.output||'.graphics-review/ground-night-validation')};
}

function buildJobs(config){
  const {url,buildId,dir}=config,receipt=[`--url=${url}`,`--build-id=${buildId}`];
  const flight=['scripts/graphics-flight.cjs',...receipt,'--stage=immersive','--width=1920','--height=1080','--agl-ft=150','--boost'];
  const liveUrl=`${url}/?graphics=immersive&graphicsReview=1`;
  const moving={purpose:'Moving flight and quality transitions',worldPins:'No terrain/governor/depth/settle/clutter/aerial pins; real traffic and resident imagery required',
    inputs:'Forgiving crash mode; native DPR1; time/baseline weather controlled; existing boost meter; supplied low-AGL route'};
  const legacy={purpose:'Inherited regression, frozen assertion values',worldPins:'FLY_SHIPPED releases terrain/settle/clutter/depth/aerial/shadow pins; inherited governor hold and infinite boost remain',
    inputs:'Inherited baseline weather, poses, DSF and duration; detailed shipped-control census in log'};
  const json=(name,command,controls=moving,environment={})=>({command,environment,controls,evidence:path.join(dir,`${name}.json`)});
  return {
    flight:json('flight',[...flight,'--hour=4','--seconds=120','--scenario=urban',`--output=${dir}/flight.json`]),
    day:json('day',[...flight,'--hour=17','--seconds=900','--scenario=mixed',`--output=${dir}/day.json`]),
    night:json('night',[...flight,'--hour=4','--seconds=900','--scenario=urban',`--output=${dir}/night.json`]),
    clouds:{command:['scripts/immersive-rebase.cjs',...receipt,`--output=${dir}/clouds`],environment:{},evidence:path.join(dir,'clouds/report.json'),
      controls:{purpose:'Cloud-pixel stability through real warp/rebase; not a performance gate',worldPins:'Governor hold; no inherited terrain/depth pins',inputs:'Stationary absolute pose, overcast and daytime controlled by existing cloud harness'}},
    weather:{command:['scripts/immersive-regression.cjs',...receipt,'--only=weather',`--output=${dir}/weather`],environment:{},evidence:path.join(dir,'weather/report.json'),
      controls:{purpose:'Weather/atmosphere integration; not a performance gate',worldPins:'Governor hold; no inherited terrain/depth pins',inputs:'Fixed pose; existing clear/few/overcast/rain transition sequence'}},
    flash:{command:['scripts/immersive-flash-regression.cjs'],environment:{FLY_URL:liveUrl,FLY_SHIPPED:'1',POSE:'powell',FLASH_OUTPUT:path.join(dir,'flash')},
      evidence:path.join(dir,'flash/report.json'),controls:legacy},
    steps:{command:['scripts/immersive-step-regression.cjs'],environment:{FLY_URL:liveUrl,FLY_SHIPPED:'1',STEP_BUILD_ID:buildId,STEP_OUTPUT:path.join(dir,'steps')},
      controls:{...legacy,worldPins:'Governor and settle pins are released; FLY_SHIPPED also releases terrain/clutter/depth/aerial/shadow pins; inherited infinite boost remains',
        inputs:'Existing forced governor steps followed by the live window; inherited baseline weather, poses, DSF and durations; detailed control census in log'}},
    pace:{command:['-r','./scripts/immersive-legacy-preload.cjs','scripts/verify-frame-pace.js'],
      environment:{FLY_URL:liveUrl,FRAME_PACE_STRICT:'1',IMMERSIVE_PACE_STEPS:'1'},
      controls:{purpose:'Strict inherited pacing/resize regression, frozen assertion values',worldPins:'Preload releases governor/terrain/settle/clutter/depth/aerial/shadow pins; inherited infinite boost and baseline weather remain',
        inputs:'Existing deliberate governor force(-1) at 15s and force(1) at 45s; original pacing bounds and durations'}},
  };
}

function classify(code,signal,evidence){
  if(signal||code==null)return 'BLOCKED';
  if(code!==0)return code===2?'BLOCKED':'FAIL';
  return ['FAIL','BLOCKED'].includes(evidence?.status)?evidence.status:'PASS';
}
function localSource(){return require('./ground-night-source.cjs')(repo);}
function readEvidence(file,startedAt){
  if(!file)return {};
  try{
    const stat=fs.statSync(file);
    if(!stat.isFile())throw Error('Declared evidence is not a file');
    if(!Number.isFinite(Date.parse(startedAt)))throw Error('Child start time unavailable');
    if(stat.mtimeMs+1<Date.parse(startedAt))throw Error('Evidence predates this child run');
    const evidence=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))throw Error('Evidence must be a JSON object');
    return {evidence};
  }catch(error){return {evidenceError:`Declared evidence unavailable: ${error.message}`};}
}
function assessJob({name,code,signal,evidence,evidenceError,requiresEvidence,buildId,sourceSha256}){
  const status=classify(code,signal,evidence);
  // Preserve a child's explicit failure/block. Missing output must never turn
  // an exit-1 regression into a mere missing-evidence block.
  if(status!=='PASS')return {status};
  if(requiresEvidence&&(evidenceError||!evidence))return {status:'BLOCKED',error:evidenceError||'Declared child evidence unavailable'};
  if(['flight','day','night','clouds','weather'].includes(name)){
    if(evidence?.status!=='PASS'||evidence.servedBuild?.buildId!==buildId||evidence.servedBuild?.sourceSha256!==sourceSha256){
      return {status:'BLOCKED',error:'Child result or served source receipt unavailable/mismatched'};
    }
  }
  if(name==='flash'){
    // The legacy flash report intentionally has no status field. Its named
    // gate results are the receipt; an empty/partial write cannot certify it.
    if(!Array.isArray(evidence?.results)||!evidence.results.length||evidence.results.some(r=>!r||typeof r.pass!=='boolean')){
      return {status:'BLOCKED',error:'Flash evidence requires nonempty boolean gate results'};
    }
    if(evidence.results.some(r=>!r.pass)||evidence.errors?.length)return {status:'FAIL',error:'Flash evidence contains a failed gate or runtime error'};
    const ids=evidence.results.map(r=>r.n);
    if(ids.length!==FLASH_GATE_IDS.length||new Set(ids).size!==FLASH_GATE_IDS.length||!FLASH_GATE_IDS.every(id=>ids.includes(id))){
      return {status:'BLOCKED',error:'Flash evidence requires each expected gate identity 1–9 exactly once'};
    }
    if(evidence.status!==undefined&&evidence.status!=='PASS')return {status:'BLOCKED',error:'Flash evidence is not a completed result'};
  }
  // Steps and pace intentionally declare no JSON report: their original
  // exit-code + captured-log contract remains unchanged.
  return {status:'PASS'};
}

async function run(config){
  fs.mkdirSync(config.dir,{recursive:true});
  const jobs=buildJobs(config),report={...localSource(),startedAt:new Date().toISOString(),status:'IN_PROGRESS',
    url:config.url,requestedBuildId:config.buildId,selected:config.checks,jobs:[],
    sourceContract:'One suite preflight receipt; modern child gates additionally verify the same build ID. Legacy gates share this URL and the suite receipt; their existing world pins are recorded per job.',
    restoredEnvironmentDefaults:defaultsToRestore.filter(key=>process.env[key]!==undefined)};
  const receiptPath=path.join(config.dir,`suite-${config.checks.join('-')}.json`);
  const save=()=>fs.writeFileSync(receiptPath,JSON.stringify(report,null,2));
  let active=null,interrupted=false;
  const interrupt=()=>{interrupted=true;active?.kill('SIGTERM');};
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  try{
    save();
    const endpoint=`${config.url}/_next/static/${encodeURIComponent(config.buildId)}/ground-source.json`;
    const response=await fetch(endpoint,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error(`Served build receipt unavailable (${response.status})`);
    report.servedBuild=validateReceipt(await response.json(),config.buildId);
    const documentResponse=await fetch(`${config.url}/?graphics=immersive&graphicsReview=1`,{signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!documentResponse.ok)throw Error(`App document unavailable (${documentResponse.status})`);
    report.servedBuild=bindDocument(report.servedBuild,await documentResponse.text(),documentResponse.url,config.url);
    report.receiptVerifiedAt=new Date().toISOString();report.receiptEndpoint=endpoint;
    // Source hashes exclude helper scripts. A different checkout is recorded,
    // not confused with the source identity of the server being measured.
    report.localSourceMatchesServed=report.sourceSha256===report.servedBuild.sourceSha256;
    save();console.log(`Verified served build ${config.buildId}; ${config.checks.length} sequential check(s)`);
    for(const name of config.checks){
      if(interrupted)break;
      const job=jobs[name],entry={name,status:'RUNNING',startedAt:new Date().toISOString(),command:[process.execPath,...job.command],
        environment:job.environment,controls:job.controls,log:path.join(config.dir,`${name}.log`),evidence:job.evidence};
      report.jobs.push(entry);save();console.log(`Starting ${name}; log: ${entry.log}`);
      const env={...process.env};for(const key of defaultsToRestore)delete env[key];Object.assign(env,job.environment);
      const log=fs.createWriteStream(entry.log);
      const outcome=await new Promise(resolve=>{
        let settled=false;
        const finish=value=>{if(settled)return;settled=true;resolve(value);};
        active=spawn(process.execPath,job.command,{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe'],env});
        active.stdout.on('data',data=>log.write(data));active.stderr.on('data',data=>log.write(data));
        active.on('error',error=>{entry.error=error.message;finish({code:2});});
        active.on('close',(code,signal)=>finish({code,signal}));
      });
      active=null;await new Promise(resolve=>log.end(resolve));
      const {evidence,evidenceError}=readEvidence(job.evidence,entry.startedAt);
      if(evidence)entry.childStatus=evidence.status;
      if(evidenceError)entry.evidenceError=evidenceError;
      entry.exitCode=outcome.code;entry.signal=outcome.signal??null;entry.finishedAt=new Date().toISOString();
      const verdict=assessJob({name,code:outcome.code,signal:outcome.signal,evidence,evidenceError,requiresEvidence:!!job.evidence,
        buildId:config.buildId,sourceSha256:report.servedBuild.sourceSha256});
      entry.status=interrupted?'BLOCKED':verdict.status;
      if(verdict.error)entry.error=verdict.error;
      save();console.log(`${name}: ${entry.status} (exit ${outcome.code??outcome.signal})`);
      if(entry.status!=='PASS')break;
    }
    report.status=report.jobs.some(j=>j.status==='FAIL')?'FAIL':interrupted||report.jobs.length!==config.checks.length||report.jobs.some(j=>j.status!=='PASS')?'BLOCKED':'PASS';
    report.notRun=config.checks.slice(report.jobs.length);
    if(interrupted)report.reason='Interrupted; remaining checks were not run';
  }catch(error){report.status='BLOCKED';report.reason=error.message;}
  finally{
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
    report.finishedAt=new Date().toISOString();save();console.log(`GROUND NIGHT VALIDATION: ${report.status}; report: ${receiptPath}`);
  }
  return report;
}

module.exports={parseArgs,buildJobs,validateReceipt,classify,localSource,readEvidence,assessJob,run,FLASH_GATE_IDS};
if(require.main===module){
  (async()=>{
    const config=parseArgs(process.argv.slice(2));
    if(config.help){console.log('Required: --url=ORIGIN --build-id=ID; --checks=flight,day,night,clouds,weather,flash,steps,pace (default: flight); optional --output=DIR');return;}
    process.chdir(repo);
    const report=await run(config);process.exitCode=report.status==='PASS'?0:report.status==='FAIL'?1:2;
  })().catch(error=>{console.error(`GROUND NIGHT VALIDATION: BLOCKED — ${error.message}`);process.exitCode=2;});
}
