import assert from 'node:assert/strict';
import {register} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
register('./_node-resolve.mjs',import.meta.url);
register('./_r25-b-ssr-loader.mjs',import.meta.url);
const {AdventureExperience}=await import('../components/fly/hud/AdventureExperience.jsx');
const {AdventureController}=await import('../lib/fly/adventure-controller.mjs');
const {useAdventureStore}=await import('../stores/adventure-store.js');
const {useFlyStore}=await import('../stores/fly-store.js');
const controller=new AdventureController();controller.start('canyon-discovery');
// Zustand server rendering reads the initial snapshot. These isolated test
// stores exercise the real component; only its WebGL preview is stubbed.
Object.assign(useAdventureStore.getInitialState(),{progress:controller.progress,libraryOpen:false,summary:null});
Object.assign(useFlyStore.getInitialState(),{screen:'flight',phase:'flying',cameraMode:'chase',atlasOpen:false,logbookOpen:false});
const runtime={adventures:{controller},adventureEnvironment:{mode:'live'}};
const render=()=>renderToStaticMarkup(React.createElement(AdventureExperience,{runtime}));
assert.match(render(),/data-testid="adventure-hud"/);
assert.match(render(),/WASD/,'the opening objective should explain steering');
controller.pause();
assert.match(render(),/Resume adventure/,'an interrupted journey retains its recovery action');
runtime.adventureEnvironment=null;
assert.doesNotMatch(render(),/adventure-hud|Resume adventure/,'an ordinary flight must not show a suspended journey panel');
assert.equal(controller.progress.active.id,'canyon-discovery','hiding the panel must retain Continue progress');
console.log('PASS: active and interrupted adventure HUD, first-flight controls, and suspended-journey isolation in Free Flight.');
