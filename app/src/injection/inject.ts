import { buildBridgeRuntime } from './bridge-runtime';
import { buildCastShim } from './cast-shim';
import { USERSCRIPT_SOURCE } from './userscript-source';

export function buildInjectedJavaScript(): string {
  const bridge = buildBridgeRuntime();
  const castShim = buildCastShim();

  // Cast shim FIRST — must be on window before any page JS runs.
  return `
${castShim}

${bridge}

// --- Userscript Movix ---
${USERSCRIPT_SOURCE}

true;
`;
}
