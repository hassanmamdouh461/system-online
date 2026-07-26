/**
 * Node ESM loader for running the app's TypeScript sources directly in tests.
 *
 * Two shims, so tests exercise the REAL source files rather than copies:
 *
 *  1. resolve — Vite/esbuild allow extensionless relative imports
 *     (`from './cloudConfig'`); Node's ESM resolver requires the extension.
 *     We append `.ts` when a relative specifier has none.
 *
 *  2. load — `import.meta.env` is a Vite compile-time construct that does not
 *     exist in Node, so any module reading it would throw. We rewrite it to
 *     `globalThis.__VITE_ENV__` (defaulted to an empty object), letting a test
 *     set env vars by assigning that global before importing.
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[mc]?[jt]sx?$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through to default resolution
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (/\.tsx?$/.test(url) && result.source) {
    const src = result.source.toString();
    if (src.includes('import.meta.env')) {
      result.source = src.replace(
        /import\.meta\.env/g,
        '(globalThis.__VITE_ENV__ ??= {})'
      );
    }
  }
  return result;
}
