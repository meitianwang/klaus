/**
 * Build script for Claude Code Engine module (used by Klaus).
 *
 * Usage:
 *   bun run build-engine.ts
 *   bun run build-engine.ts --features=CONTEXT_COLLAPSE,CACHED_MICROCOMPACT,REACTIVE_COMPACT
 *
 * Output: dist/engine.js — single ESM bundle exporting the engine API.
 */

import { resolve, dirname } from "path";

const rootDir = dirname(new URL(import.meta.url).pathname);
const featuresArg = process.argv.find((a) => a.startsWith("--features="));
const enabledFeatures = new Set(
  featuresArg ? featuresArg.split("=")[1]!.split(",") : [
    // Default features for Klaus
    "CONTEXT_COLLAPSE",
    "CACHED_MICROCOMPACT",
    "REACTIVE_COMPACT",
    "HISTORY_SNIP",
    "BUILTIN_EXPLORE_PLAN_AGENTS",
  ],
);

console.log("Building Claude Code Engine for Klaus...");
console.log("Enabled features:", [...enabledFeatures].join(", "));

// Internal packages not publicly available — each maps to a shim .ts file
const shimDir = resolve(rootDir, "src/shims");
const packageShims: Record<string, string> = {
  "@anthropic-ai/mcpb": resolve(shimDir, "pkg-mcpb.ts"),
  "@anthropic-ai/sandbox-runtime": resolve(shimDir, "pkg-sandbox-runtime.ts"),
  "@anthropic-ai/foundry-sdk": resolve(shimDir, "pkg-foundry-sdk.ts"),
  "@ant/computer-use-mcp": resolve(shimDir, "pkg-computer-use-mcp.ts"),
  "@ant/computer-use-input": resolve(shimDir, "pkg-computer-use-input.ts"),
  "@ant/computer-use-swift": resolve(shimDir, "pkg-computer-use-swift.ts"),
  "@ant/claude-for-chrome-mcp": resolve(shimDir, "pkg-claude-for-chrome-mcp.ts"),
  "color-diff-napi": resolve(shimDir, "pkg-color-diff-napi.ts"),
  "modifiers-napi": resolve(shimDir, "pkg-modifiers-napi.ts"),
};

const unavailablePattern = new RegExp(
  "^(" +
    Object.keys(packageShims)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")(\\/.*)?$",
);

// Build-time macros
const version = "2.1.88";
const buildTime = new Date().toISOString();
const define: Record<string, string> = {
  "MACRO.VERSION": JSON.stringify(version),
  "MACRO.BUILD_TIME": JSON.stringify(buildTime),
  "MACRO.PACKAGE_URL": JSON.stringify("@anthropic-ai/claude-code"),
  "MACRO.NATIVE_PACKAGE_URL": JSON.stringify(""),
  "MACRO.FEEDBACK_CHANNEL": JSON.stringify(
    "https://github.com/anthropics/claude-code/issues",
  ),
  "MACRO.ISSUES_EXPLAINER": JSON.stringify(
    "https://github.com/anthropics/claude-code/issues",
  ),
  "MACRO.VERSION_CHANGELOG": JSON.stringify(""),
};

const result = await Bun.build({
  entrypoints: [resolve(rootDir, "src/entrypoints/engine.ts")],
  outdir: resolve(rootDir, "dist"),
  target: "node",
  format: "esm",
  sourcemap: "external",
  define,
  external: [
    // Keep as external — resolved at runtime by Node.js
    "@anthropic-ai/sdk",
    "@anthropic-ai/sdk/*",
    "@anthropic-ai/bedrock-sdk",
    "@anthropic-ai/vertex-sdk",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "@opentelemetry/*",
    "zod",
    "zod/*",
    "lodash-es",
    "lodash-es/*",
    "execa",
    "chalk",
    "ajv",
    "strip-ansi",
    "env-paths",
    "fuse.js",
    // jsonc-parser bundled (ESM resolution issues in Node)
    "marked",
    "proper-lockfile",
    "xss",
    "p-map",
    "shell-quote",
    "ignore",
    "image-size",
    "type-fest",
    "turn-down",
    "turndown",
    "vscode-jsonrpc",
    "vscode-languageserver-protocol",
    "vscode-languageserver-types",
    "cli-highlight",
    "better-sqlite3",
    // Native modules
    "*.node",
  ],
  plugins: [
    {
      name: "bun-bundle-shim",
      setup(build) {
        build.onResolve({ filter: /^bun:bundle$/ }, () => ({
          path: resolve(rootDir, "src/shims/bun-bundle.ts"),
        }));
        build.onResolve({ filter: /^react\/compiler-runtime$/ }, () => ({
          path: resolve(
            rootDir,
            "node_modules/react-compiler-runtime/dist/index.js",
          ),
        }));
        build.onResolve({ filter: unavailablePattern }, (args) => {
          const base = Object.keys(packageShims).find((pkg) =>
            args.path === pkg || args.path.startsWith(pkg + "/"),
          );
          return { path: packageShims[base!]! };
        });
      },
    },
  ],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Rename output to engine.js
const outputs = result.outputs.map(o => o.path);
console.log(`Build complete → ${outputs.join(", ")}`);
