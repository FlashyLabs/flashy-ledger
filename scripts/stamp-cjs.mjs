import { writeFileSync } from 'node:fs'

/**
 * Mark dist-cjs as CommonJS.
 *
 * The package root declares `"type": "module"`, which applies to every .js
 * file beneath it — including the CommonJS output. Node would then load
 * dist-cjs/index.js as ESM, see `exports.x = ...`, and fail with "exports is
 * not defined", which reads like a bug in the package rather than a build
 * configuration problem.
 *
 * A package.json in the directory overrides the inherited type for that
 * subtree. Three lines, and the alternative is renaming every emitted file to
 * .cjs and rewriting its internal requires.
 */
writeFileSync(
  new URL('../dist-cjs/package.json', import.meta.url),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
)
