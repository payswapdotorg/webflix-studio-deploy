/**
 * Produces server/webflix-lab/apps/studio/web/app.js with the REAL
 * Bun.Transpiler — the exact transform the local :4313 studio performs at
 * request time (byte-parity; see server/webflix-lab/COMPAT_PATCHES.md).
 *
 * Runs under bun (prepare-time only; never shipped into the serverless
 * runtime).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_DIR = join(import.meta.dir, '..', 'server', 'webflix-lab', 'apps', 'studio', 'web');
const source = readFileSync(join(WEB_DIR, 'app.ts'), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });
const js = transpiler.transformSync(source);
writeFileSync(join(WEB_DIR, 'app.js'), js);
console.log(`transpiled app.ts -> app.js (${js.length} chars)`);
