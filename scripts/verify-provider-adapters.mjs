import assert from 'node:assert/strict';
import {register,registerHooks} from 'node:module';
register('./_node-resolve.mjs',import.meta.url);
register('./_alias-loader.mjs',import.meta.url);
// Next's bundler accepts this extensionless package subpath; native Node ESM
// needs the actual package entry. The route and NextResponse stay unmodified.
registerHooks({resolve(specifier,context,next){return next(specifier==='next/server'?'next/server.js':specifier,context);}});

const realFetch=globalThis.fetch,realNow=Date.now;
let now=Date.UTC(2026,9,7,12),calls=0;
Date.now=()=>now;
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const request=(kind,query='lat=40&lon=-74')=>new Request(`http://localhost/api/${kind}?${query}`);
try {
  const traffic=await import('../app/api/aircraft/route.js?beta-traffic');
  globalThis.fetch=async()=>{calls++;return response({now:now/1000,ac:[{hex:'abc123'}]});};
  let result=await (await traffic.GET(request('aircraft'))).json();
  assert.equal(result.ac.length,1);assert.equal(result.source,'adsb.lol');assert.equal(result.availability,'live');
  assert.equal(result.retrievedAt,now);
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:429});};
  result=await (await traffic.GET(request('aircraft'))).json();
  assert.equal(result.availability,'delayed');assert.equal(result.error,'serving_stale');assert.equal(result.ac.length,1);
  const cooled=calls;await traffic.GET(request('aircraft'));assert.equal(calls,cooled,'cooldown prevents retry storms');
  now+=91000;
  result=await (await traffic.GET(request('aircraft'))).json();assert.equal(result.availability,'unavailable');assert.equal(result.ac.length,0);
  console.log('PASS traffic source/freshness, throttling, cooldown and bounded stale expiry');

  now+=91000;
  globalThis.fetch=async()=>response({now:now/1000,ac:[]});
  result=await (await traffic.GET(request('aircraft'))).json();assert.equal(result.availability,'live');assert.equal(result.ac.length,0);
  console.log('PASS empty healthy airspace stays live');

  const weather=await import('../app/api/weather/route.js?beta-weather');
  globalThis.fetch=async()=>response({current:{time:'2026-10-07T12:00',cloud_cover:25,wind_speed_10m:3,wind_direction_10m:180}});
  result=await (await weather.GET(request('weather'))).json();assert.equal(result.found,true);assert.equal(result.source,'open-meteo');assert.equal(result.observedAt,Date.UTC(2026,9,7,12));assert.equal(result.availability,'live');
  const stamp=result.retrievedAt;
  globalThis.fetch=async()=>{throw Error('offline');};
  result=await (await weather.GET(request('weather'))).json();assert.equal(result.retrievedAt,stamp,'cache does not invent a newer retrieval');
  result=await (await weather.GET(request('weather','lat=-30&lon=150'))).json();assert.equal(result.found,false);assert.equal(result.availability,'unavailable');
  console.log('PASS weather preserves observation time, cache provenance and offline fallback');

  globalThis.fetch=async()=>{throw Error('invalid coordinates reached upstream');};
  const invalid=await weather.GET(request('weather','lat=bad&lon=150'));assert.equal((await invalid.json()).found,false);
  console.log('PASS invalid positions never become a fabricated weather observation');
} finally {globalThis.fetch=realFetch;Date.now=realNow;}
