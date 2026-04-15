/**
 * Build script for Claude Code from source.
 *
 * Usage:
 *   bun run build.ts
 *   bun run build.ts --features=BRIDGE_MODE,BUDDY
 *
 * This replicates the essential parts of Anthropic's internal build pipeline
 * for the open-source extracted source tree.
 */

import { resolve, dirname } from "path";

const rootDir = dirname(new URL(import.meta.url).pathname);
const featuresArg = process.argv.find((a) => a.startsWith("--features="));
const enabledFeatures = new Set(
  featuresArg ? featuresArg.split("=")[1]!.split(",") : [],
);

console.log("Building Claude Code from source...");
if (enabledFeatures.size > 0) {
  console.log("Enabled features:", [...enabledFeatures].join(", "));
}

// Internal packages not publicly available — each maps to a shim .ts file
// that exports the exact named exports the source code imports.
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

// Build a regex that matches the package name and any subpath imports
const unavailablePattern = new RegExp(
  "^(" +
    Object.keys(packageShims)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")(\\/.*)?$",
);

// Build-time macros — injected via `define` as global constants
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
  entrypoints: [resolve(rootDir, "src/entrypoints/cli.tsx")],
  outdir: resolve(rootDir, "dist"),
  target: "bun",
  sourcemap: "external",
  define,
  external: [
    // Native .node modules resolved at runtime
    "*.node",
  ],
  plugins: [
    {
      name: "bun-bundle-shim",
      setup(build) {
        // Redirect `bun:bundle` imports to our runtime shim
        build.onResolve({ filter: /^bun:bundle$/ }, () => ({
          path: resolve(rootDir, "src/shims/bun-bundle.ts"),
        }));
        // Map `react/compiler-runtime` to the `react-compiler-runtime` package
        build.onResolve({ filter: /^react\/compiler-runtime$/ }, () => ({
          path: resolve(
            rootDir,
            "node_modules/react-compiler-runtime/dist/index.js",
          ),
        }));
        // Shim unavailable internal packages — resolve to .ts shim files
        build.onResolve({ filter: unavailablePattern }, (args) => {
          // Strip subpath to find the base package name
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

console.log(
  `Build complete → dist/cli.js (${result.outputs.length} outputs)`,
);
