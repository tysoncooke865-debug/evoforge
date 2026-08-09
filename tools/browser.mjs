/**
 * WHERE PLAYWRIGHT LIVES.
 *
 * Every browser tool in here used to resolve it through a `createRequire`
 * pointed at an absolute path inside one session's scratchpad:
 *
 *   file:///C:/Users/.../Temp/claude/C--Users-tyson/cff4b4d5-.../scratchpad/
 *
 * That directory is temporary. When the session that created it ended, the
 * install went with it and all three tours died at the import — not at an
 * assertion, at line 20, before a single check ran. A verification tool that
 * cannot start is worse than one that fails, because "it errored" reads like an
 * environment problem rather than a missing guarantee.
 *
 * Playwright is deliberately NOT a dependency of `client/`: it pulls a browser
 * download into every `npm ci` on CI, which runs no browser tours. So it lives
 * beside the tools that use it, in a gitignored folder, and this resolves it
 * from a few sane places in order.
 *
 *   npm --prefix tools/.browser install playwright
 *   npx --prefix tools/.browser playwright install chromium
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url);
const CANDIDATES = [
  // 1. an explicit override, for a shared or preinstalled copy
  process.env.PLAYWRIGHT_ROOT,
  // 2. the tools' own install — the documented home
  new URL('.browser/', HERE).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  // 3. the repo root and the client, in case somebody added it as a dep
  new URL('../', HERE).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  new URL('../client/', HERE).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
].filter(Boolean);

function resolveChromium() {
  const tried = [];
  for (const root of CANDIDATES) {
    const modules = join(root, 'node_modules', 'playwright');
    tried.push(modules);
    if (!existsSync(modules)) continue;
    try {
      const require = createRequire(pathToFileURL(join(root, 'noop.js')));
      return require('playwright');
    } catch (e) {
      tried.push(`  (found but failed to load: ${e.message})`);
    }
  }
  throw new Error(
    'playwright is not installed anywhere this tool can see.\n\n'
    + '  npm --prefix tools/.browser install playwright\n'
    + '  npx --prefix tools/.browser playwright install chromium\n\n'
    + 'or set PLAYWRIGHT_ROOT to a directory whose node_modules has it.\n'
    + 'Looked in:\n  - ' + tried.join('\n  - ')
  );
}

export const { chromium } = resolveChromium();
