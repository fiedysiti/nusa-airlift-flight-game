// Module-resolution hook for the Node sim harness: maps the bare
// specifier 'three' to the vendored build, exactly like the game's
// import map does in the browser. No other specifiers are touched.
import { pathToFileURL } from 'node:url';

const THREE_URL = new URL('../game/vendor/three.module.min.js', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: THREE_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
