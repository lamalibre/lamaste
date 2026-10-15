// Bundle the agent half of an e2e app plugin fixture into one self-contained
// ES module, the way a real app plugin ships its agent package: no runtime
// dependencies, Node.js built-ins only. `write_app_install_fixture`
// (helpers.sh) writes the source and runs this script.
//
//   node build-app-agent-half.js --entry <source.mjs> --outfile <dist/agentd.mjs> \
//     --route <plugin route> --mode <fixture mode>
//
// `@lamalibre/lamaste/agent` resolves to this workspace's build of the core
// library (packages/core/lib/dist — `npm run build` first), so the fixture
// runs the caller-assertion verifier and hook handler of the Lamaste under
// test. `--route` and `--mode` become the constants `__E2E_ROUTE__` and
// `__E2E_MODE__` of the source. The script fails when the bundle would
// import anything but a Node.js built-in at run time.

import { access } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const ROUTE_RE = /^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/;
const MODE_RE = /^[a-z]{1,20}$/;
const LAMASTE_AGENT = '@lamalibre/lamaste/agent';

function fail(message) {
  process.stderr.write(`build-app-agent-half: ${message}\n`);
  process.exit(1);
}

const { values: opts } = parseArgs({
  options: {
    entry: { type: 'string' },
    outfile: { type: 'string' },
    route: { type: 'string' },
    mode: { type: 'string' },
  },
  strict: true,
});
if (!opts.entry || !opts.outfile || !opts.route || !opts.mode) {
  fail('usage: --entry <source.mjs> --outfile <file.mjs> --route <route> --mode <mode>');
}
if (!ROUTE_RE.test(opts.route)) fail(`invalid route "${opts.route}"`);
if (!MODE_RE.test(opts.mode)) fail(`invalid mode "${opts.mode}"`);

// Node's own resolution from this file: the workspace's @lamalibre/lamaste
// (a link to packages/core/lib), through its "exports" map.
let agentEntry;
try {
  agentEntry = fileURLToPath(import.meta.resolve(LAMASTE_AGENT));
  await access(agentEntry);
} catch {
  fail(`${LAMASTE_AGENT} is not built in this workspace (npm run build -w packages/core/lib)`);
}

const lamasteAgent = {
  name: 'lamaste-agent-from-workspace',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^@lamalibre\/lamaste\/agent$/ }, () => ({
      path: agentEntry,
    }));
  },
};

const outfile = path.resolve(opts.outfile);
// This file sits in packages/tools/lamaste-rodeo/tests/e2e: the bundle names
// the modules it holds relative to the workspace, not to this machine.
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
let result;
try {
  result = await build({
    absWorkingDir: workspaceRoot,
    entryPoints: [path.resolve(opts.entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // A bundled CommonJS module that requires a Node.js built-in calls
    // require(), which an ES module lacks; the bundle provides one.
    banner: {
      js: "import { createRequire as __e2eCreateRequire } from 'node:module';\nconst require = __e2eCreateRequire(import.meta.url);",
    },
    define: {
      __E2E_ROUTE__: JSON.stringify(opts.route),
      __E2E_MODE__: JSON.stringify(opts.mode),
    },
    plugins: [lamasteAgent],
    legalComments: 'none',
    metafile: true,
    logLevel: 'silent',
  });
} catch (err) {
  const errors = Array.isArray(err?.errors) ? err.errors : [];
  fail(
    errors.length > 0
      ? errors.map((e) => `${e.location?.file ?? ''} ${e.text}`.trim()).join('; ')
      : String(err?.message ?? err),
  );
}

// One entry point, no splitting and no source map: one output file.
const outputs = Object.values(result.metafile.outputs);
if (outputs.length !== 1) fail(`esbuild wrote ${outputs.length} files, not one bundle`);
const [output] = outputs;
const runtimeImports = output.imports.filter((i) => !isBuiltin(i.path));
if (runtimeImports.length > 0) {
  fail(
    `the bundle still imports ${runtimeImports.map((i) => i.path).join(', ')} — ` +
      'an agent half ships with Node.js built-ins only',
  );
}
const lamasteDist = path.dirname(path.dirname(agentEntry));
const fromLamaste = Object.keys(result.metafile.inputs).some((input) =>
  path.resolve(workspaceRoot, input).startsWith(`${lamasteDist}${path.sep}`),
);
if (!fromLamaste) fail(`the bundle contains nothing of ${LAMASTE_AGENT}`);
process.stdout.write(`${outfile} (${output.bytes} bytes)\n`);
