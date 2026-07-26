/**
 * Node ESM resolver hook for running the Worker's TypeScript sources directly.
 *
 * Wrangler/esbuild resolve extensionless imports (`from "./auth"`), but Node's
 * ESM resolver requires an explicit specifier. This hook appends `.ts` for
 * relative imports that have no extension, so the production sources stay
 * idiomatic and the tests can still import them with --experimental-strip-types.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through to the default resolution below
    }
  }
  return nextResolve(specifier, context);
}
