// Lists the test files explicitly: `node --test <dir>` behaves differently across Node versions.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'test'))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => join('test', name));

const { status } = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exit(status ?? 1);
