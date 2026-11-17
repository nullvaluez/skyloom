const PLUGIN_NAME = 'ImmutableDevWorkerEntries';
const WORKER_FILENAME = 'static/chunks/worker-[id].[contenthash:16].js';

/**
 * Next's webpack dev server serves emitted chunks from disk. Worker entry URLs
 * normally stay the same when another on-demand compilation rewrites them, so a
 * response can straddle two versions of an eval bundle. Give only worker entries
 * content-addressed paths; webpack's WorkerDependency emits the matching URL.
 *
 * Use the entry's id as well as its hash: unnamed async entries have no [name].
 * Next does not clean this output between dev compilations, so an already-issued
 * worker URL remains readable while its replacement is being compiled.
 */
export class ImmutableDevWorkerEntriesPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, compilation => {
      compilation.hooks.finishModules.tap(PLUGIN_NAME, modules => {
        const visit = block => {
          if (block.groupOptions?.entryOptions && block.dependencies?.some(dependency =>
            dependency.category === 'worker' && dependency.type === 'new Worker()')) {
            block.groupOptions = {
              ...block.groupOptions,
              entryOptions: { ...block.groupOptions.entryOptions, filename: WORKER_FILENAME },
            };
          }
          for (const child of block.blocks || []) visit(child);
        };
        for (const compilationModule of modules) visit(compilationModule);
      });
    });
  }
}

export function configureDevWorkerAssets(config, { dev, isServer }) {
  if (dev && !isServer) {
    config.plugins ||= [];
    config.plugins.push(new ImmutableDevWorkerEntriesPlugin());
  }
  return config;
}
