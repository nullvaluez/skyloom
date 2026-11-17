import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { configureDevWorkerAssets } from '../lib/build/dev-worker-assets.mjs';

// Exercise Next's installed webpack and its actual WorkerDependency URL runtime.
// No Next server, browser, GPU or app compilation is needed.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');
// The Windows sandbox temp path contains "!", which webpack reserves for loaders.
const fixtureRoot = fileURLToPath(new URL('../.graphics-review/dev-worker-fixtures/', import.meta.url));
await fs.mkdir(fixtureRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(fixtureRoot, 'fixture-'));
const output = path.join(directory, 'out');
let checks = 0;
const check = message => { checks++; console.log(`ok ${checks} - ${message}`); };

async function compile(context = { dev: true, isServer: false }) {
  const config = configureDevWorkerAssets({
    context: directory,
    mode: 'development',
    target: 'web',
    cache: false,
    devtool: 'eval-source-map',
    entry: { main: './main.js' },
    output: {
      path: output,
      filename: 'static/chunks/[name].js',
      chunkFilename: 'static/chunks/[name].js',
      publicPath: '/_next/',
      hashFunction: 'sha256',
      library: { name: 'workerFixture', type: 'var' },
    },
    optimization: { minimize: false, runtimeChunk: { name: 'webpack' } },
    plugins: context.dev ? [new webpack.HotModuleReplacementPlugin()] : [],
  }, context);
  const compiler = webpack(config);
  try {
    const stats = await new Promise((resolve, reject) => compiler.run((error, result) =>
      error ? reject(error) : resolve(result)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    return stats.toJson({ all: false, assets: true }).assets.map(asset => asset.name);
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
}

async function workerURLs() {
  const urls = [];
  const sandbox = {
    URL,
    self: { location: { href: 'http://fixture.test/' } },
    document: { baseURI: 'http://fixture.test/' },
    Worker: class { constructor(url) { urls.push(new URL(url).pathname); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(await fs.readFile(path.join(output, 'static/chunks/webpack.js'), 'utf8'), sandbox);
  vm.runInContext(await fs.readFile(path.join(output, 'static/chunks/main.js'), 'utf8'), sandbox);
  sandbox.workerFixture.start();
  return urls.map(url => {
    assert.ok(url.startsWith('/_next/'));
    return url.slice('/_next/'.length);
  });
}

async function runWorker(filename) {
  const messages = [];
  const source = await fs.readFile(path.join(output, filename), 'utf8');
  vm.runInNewContext(source, {
    self: { location: { href: `http://fixture.test/_next/${filename}` } },
    postMessage: message => messages.push(message),
  });
  return { source, messages };
}

try {
  await fs.writeFile(path.join(directory, 'main.js'), `
    export function start() {
      new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      new Worker(new URL('./second.js', import.meta.url), { type: 'module', name: 'named-worker' });
    }
    export function ordinary() { return import(/* webpackChunkName: "ordinary" */ './ordinary.js'); }
  `);
  await fs.writeFile(path.join(directory, 'worker.js'), "import { value } from './shared.js'; postMessage(value);\n");
  await fs.writeFile(path.join(directory, 'shared.js'), "export const value = 'version-one';\n");
  await fs.writeFile(path.join(directory, 'second.js'), "postMessage('second-worker');\n");
  await fs.writeFile(path.join(directory, 'ordinary.js'), "export default 'ordinary-chunk';\n");

  const initialAssets = await compile();
  const initialURLs = await workerURLs();
  assert.equal(initialURLs.length, 2);
  for (const url of initialURLs) assert.match(url, /^static\/chunks\/worker-.+\.[0-9a-f]{16}\.js$/);
  assert.equal(new Set(initialURLs).size, 2);
  assert.ok(initialURLs.every(url => initialAssets.includes(url)));
  check('named and unnamed workers get distinct identity-plus-content-hash URLs matching emitted assets');

  const first = await runWorker(initialURLs[0]);
  const second = await runWorker(initialURLs[1]);
  assert.equal(first.messages[0], 'version-one');
  assert.equal(second.messages[0], 'second-worker');
  check('both emitted eval-source-map worker bundles execute their real bootstrap');

  const ordinaryFile = 'static/chunks/ordinary.js';
  assert.ok(initialAssets.includes(ordinaryFile));
  const ordinarySource = await fs.readFile(path.join(output, ordinaryFile), 'utf8');
  await compile();
  assert.deepEqual(await workerURLs(), initialURLs);
  assert.equal((await runWorker(initialURLs[0])).source, first.source);
  check('an unchanged compilation keeps the same worker URLs and bytes');

  await fs.writeFile(path.join(directory, 'shared.js'), "export const value = 'version-two';\n");
  const changedAssets = await compile();
  const changedURLs = await workerURLs();
  assert.notEqual(changedURLs[0], initialURLs[0]);
  // HMR embeds the compilation hash in each worker runtime. Even a worker whose
  // module did not change can need a new URL; the old bytes must still survive.
  assert.ok(changedAssets.includes(changedURLs[0]));
  assert.equal((await runWorker(changedURLs[0])).messages[0], 'version-two');
  assert.equal((await runWorker(initialURLs[0])).source, first.source);
  assert.equal((await runWorker(initialURLs[0])).messages[0], 'version-one');
  assert.equal((await runWorker(initialURLs[1])).source, second.source);
  assert.equal((await runWorker(changedURLs[1])).messages[0], 'second-worker');
  check('a dependency edit publishes a new worker URL while the complete previous worker remains readable');

  assert.ok(changedAssets.includes(ordinaryFile));
  assert.equal(await fs.readFile(path.join(output, ordinaryFile), 'utf8'), ordinarySource);
  check('ordinary dynamic chunk filenames and contents are unchanged');

  for (const context of [{ dev: false, isServer: false }, { dev: true, isServer: true }]) {
    const original = { plugins: [], output: { filename: 'existing.js' }, cache: true };
    const snapshot = structuredClone(original);
    assert.equal(configureDevWorkerAssets(original, context), original);
    assert.deepEqual(original, snapshot);
  }
  await compile({ dev: false, isServer: false });
  const productionURLs = await workerURLs();
  assert.ok(productionURLs.every(url => !url.includes('/worker-') && !/\.[0-9a-f]{16}\.js$/.test(url)));
  check('production and server configuration remain untouched, including actual emitted worker URLs');

  // Next sets TURBOPACK before importing configuration (including its default).
  // Cover normal --webpack without the optional review-build directory as well.
  const previous = Object.fromEntries(['TURBOPACK', 'FLY_BUILD_DIR', 'NEXT_PUBLIC_BUILD_SHA'].map(key => [key, process.env[key]]));
  try {
    delete process.env.FLY_BUILD_DIR;
    delete process.env.TURBOPACK;
    process.env.NEXT_PUBLIC_BUILD_SHA = 'worker-fixture';
    const explicitWebpack = (await import('../next.config.mjs?worker-fixture-webpack')).default;
    const client = explicitWebpack.webpack({ plugins: [], cache: true }, { dev: true, isServer: false });
    assert.equal(client.plugins.length, 1);
    assert.equal(client.cache, true);
    const production = { plugins: [], cache: true };
    assert.equal(explicitWebpack.webpack(production, { dev: false, isServer: false }), production);
    assert.deepEqual(production, { plugins: [], cache: true });
    process.env.TURBOPACK = 'auto';
    const normalTurbo = (await import('../next.config.mjs?worker-fixture-turbo')).default;
    assert.equal(normalTurbo.webpack, undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  check('normal next dev --webpack is covered; default Turbopack and production retain their configuration');
  console.log(`${checks}/${checks} dev worker asset checks passed`);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
