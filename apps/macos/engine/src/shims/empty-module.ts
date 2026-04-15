/**
 * Universal empty module shim for unavailable internal packages.
 * Uses a Proxy to accept any named import without throwing.
 * Every named export resolves to a no-op function that returns undefined.
 */
const handler: ProxyHandler<Record<string, unknown>> = {
  get(_target, prop) {
    if (prop === "__esModule") return true;
    if (prop === "default") return proxy;
    // Return a no-op function for any named export
    return function unavailableShim() {
      throw new Error(
        `Called shimmed export "${String(prop)}" from an unavailable internal package`,
      );
    };
  },
};

const proxy = new Proxy({} as Record<string, unknown>, handler);

export default proxy;

// Re-export proxy members for named imports —
// bun's bundler needs static named exports, so we use module.exports
// to allow any name to resolve at runtime.
module.exports = proxy;
module.exports.default = proxy;
