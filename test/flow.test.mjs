import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { belowFloors, ownFiles, parseLcov, totals } from '../scripts/lib/coverage.mjs';
import {
  WORK_PREFIXES, compareVersions, draftNotes, flowProblem, mainPullRequest, mergedBranches, nextVersion, planDevelop,
  releasePullRequest, versionOfReleaseBranch, versionTags, workPullRequest,
} from '../scripts/lib/flow.mjs';
import { PLUGIN_FOLDER, root } from '../scripts/lib/project.mjs';
import { manifestVersion, setVersion, versionMismatches } from '../scripts/lib/version.mjs';

const VERSION_FILES = ['package.json', 'package-lock.json', `${PLUGIN_FOLDER}/package.json`, `${PLUGIN_FOLDER}/package-lock.json`, `${PLUGIN_FOLDER}/manifest.json`];
const TICKED = '- [x] Ran docs/VERIFY.md on a real device';

test('versions compare as numbers, not as text', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
  assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
});

test('only real version tags count, lowest first', () => {
  assert.deepEqual(versionTags(['v1.10.0', 'v1.9.0', 'v.1.4.0', 'nightly', 'v2.0', 'v1.2.3-rc.1']), ['1.9.0', '1.10.0']);
});

test('the merged branch comes from what GitHub writes, for this repository and for forks', () => {
  assert.deepEqual(mergedBranches([
    'Merge pull request #6 from Weslley08/feat/choose-exact-place',
    'Merge pull request #7 from someone-else/fix/typo',
    "Merge branch 'main' into feat/x",
    'Show official Defesa Civil alerts',
  ]), ['feat/choose-exact-place', 'fix/typo']);
});

test('a feature raises the second number and anything else the third', () => {
  assert.equal(nextVersion('1.4.2', ['fix/a', 'feat/b']), '1.5.0');
  assert.equal(nextVersion('1.4.2', ['feature/b']), '1.5.0');
  assert.equal(nextVersion('1.4.2', ['fix/a', 'chore/b', 'bump/v1.4.3']), '1.4.3');
  assert.equal(nextVersion('1.4.2', ['featured/not-really']), '1.4.3');
});

test('develop asks for a new version when its own is already released', () => {
  assert.deepEqual(planDevelop({ version: '1.4.0', tags: ['1.3.0', '1.4.0'], branches: ['fix/a'] }), { bump: '1.4.1' });
  assert.deepEqual(planDevelop({ version: '1.4.0', tags: ['1.4.0'], branches: ['feat/a'] }), { bump: '1.5.0' });
});

test('develop goes to a release once its version is free', () => {
  assert.deepEqual(planDevelop({ version: '1.4.1', tags: ['1.4.0'], branches: ['fix/a', 'bump/v1.4.1'] }), { release: '1.4.1' });
  assert.deepEqual(planDevelop({ version: '1.5.0', tags: ['1.4.0'], branches: ['feat/a', 'bump/v1.5.0'] }), { release: '1.5.0' });
});

test('a feature merged after a patch was planned moves the release to a new version', () => {
  assert.deepEqual(planDevelop({ version: '1.4.1', tags: ['1.4.0'], branches: ['fix/a', 'bump/v1.4.1', 'feat/b'] }), { bump: '1.5.0' });
});

test('a version raised by hand is kept, even a big jump', () => {
  assert.deepEqual(planDevelop({ version: '2.0.0', tags: ['1.4.0'], branches: ['feat/a'] }), { release: '2.0.0' });
});

test('nothing merged since the last release asks for nothing, so running this again is safe', () => {
  assert.deepEqual(planDevelop({ version: '1.4.0', tags: ['1.4.0'], branches: [] }), { idle: true });
});

test('with no tag yet, the version in the code is the release', () => {
  assert.deepEqual(planDevelop({ version: '0.1.0', tags: [], branches: [] }), { release: '0.1.0' });
});

test('develop takes work branches and forks, but nothing back from a release', () => {
  const pr = { base: 'develop', version: '1.4.1', body: '' };
  for (const head of ['feat/x', 'fix/y', 'bump/v1.4.1', 'dependabot/npm_and_yarn/ws-8', 'main']) {
    assert.equal(flowProblem({ ...pr, head, sameRepo: true }), null, head);
  }
  assert.equal(flowProblem({ ...pr, head: 'patch-1', sameRepo: false }), null);
  assert.equal(flowProblem({ ...pr, head: 'release/v1.4.1', sameRepo: false }), null, 'a fork can name its branch anything');
  assert.match(flowProblem({ ...pr, head: 'release/v1.4.1', sameRepo: true }), /Nothing flows back/);
});

test('a release branch takes only develop from this repository, at its own version', () => {
  const pr = { base: 'release/v1.4.1', body: '' };
  assert.equal(flowProblem({ ...pr, head: 'develop', sameRepo: true, version: '1.4.1' }), null);
  assert.match(flowProblem({ ...pr, head: 'feat/x', sameRepo: true, version: '1.4.1' }), /must come from develop/);
  assert.match(flowProblem({ ...pr, head: 'develop', sameRepo: false, version: '1.4.1' }), /must come from develop/);
  assert.match(flowProblem({ ...pr, head: 'develop', sameRepo: true, version: '1.5.0' }), /says version 1\.5\.0/);
});

test('main takes only a release branch, and says what to do about anything else', () => {
  const pr = { base: 'main', version: '1.4.1', body: TICKED };
  assert.equal(flowProblem({ ...pr, head: 'release/v1.4.1', sameRepo: true }), null);
  assert.match(flowProblem({ ...pr, head: 'develop', sameRepo: true }), /Change the base of this one to develop/);
  assert.match(flowProblem({ ...pr, head: 'dependabot/npm_and_yarn/ws-8', sameRepo: true }), /Change the base of this one to develop/);
  assert.match(flowProblem({ ...pr, head: 'release/v1.4.1', sameRepo: false }), /must come from a release/);
  assert.match(flowProblem({ ...pr, head: 'release/v1.4.0', sameRepo: true }), /says version 1\.4\.1/);
});

test('main waits for the device box, because merging there publishes', () => {
  const pr = { base: 'main', head: 'release/v1.4.1', sameRepo: true, version: '1.4.1' };
  assert.match(flowProblem({ ...pr, body: '- [ ] Ran docs/VERIFY.md on a real device' }), /Run docs\/VERIFY\.md on a device/);
  assert.match(flowProblem({ ...pr, body: '- [x] Something else\nsee docs/VERIFY.md' }), /Run docs\/VERIFY\.md/);
  assert.match(flowProblem({ ...pr, body: null }), /Run docs\/VERIFY\.md/);
  assert.equal(flowProblem({ ...pr, body: `intro\n\n  ${TICKED}\n` }), null);
  assert.equal(flowProblem({ ...pr, body: '* [X] Ran docs/VERIFY.md' }), null);
});

test('the pull request to main starts with the box empty, and ticking it passes the check', () => {
  const { body } = mainPullRequest({ version: '1.4.1', repository: 'a/b', commit: 'abc', measure: 'Memory 60 MB\n' });
  const pr = { base: 'main', head: 'release/v1.4.1', sameRepo: true, version: '1.4.1' };
  assert.ok(flowProblem({ ...pr, body }));
  assert.equal(flowProblem({ ...pr, body: body.replace('- [ ]', '- [x]') }), null);
  assert.match(body, /Memory 60 MB/);
});

test('branches with other names are not release branches', () => {
  assert.equal(versionOfReleaseBranch('release/v1.4.1'), '1.4.1');
  for (const branch of ['release/1.4.1', 'release/v1.4', 'release/v1.4.1-rc', 'xrelease/v1.4.1']) assert.equal(versionOfReleaseBranch(branch), null, branch);
});

test('an opened pull request is named after the first commit and keeps the template', () => {
  const template = readFileSync(join(root, '.github', 'pull_request_template.md'), 'utf8');
  const { title, body } = workPullRequest({ branch: 'feat/x', subjects: ['Add x', 'Fix x'], template });
  assert.equal(title, 'Add x');
  assert.match(body, /- Add x\n- Fix x/);
  assert.match(body, /## How I tested it/);
  assert.doesNotMatch(body, /A sentence or two/);
});

test('the release pull request leaves out the version bumps', () => {
  const { title, body } = releasePullRequest({ version: '1.4.1', branches: ['fix/a', 'bump/v1.4.1'] });
  assert.equal(title, 'Release v1.4.1');
  assert.match(body, /`fix\/a`/);
  assert.doesNotMatch(body, /`bump\//);
});

test('draft notes say the manual check is not done and carry the numbers', () => {
  const notes = draftNotes({ repository: 'a/b', commit: 'abc', changes: '## Changes\n', measure: 'CPU idle 0.00%\n' });
  assert.match(notes, /has not been completed/);
  assert.match(notes, /blob\/abc\/docs\/VERIFY\.md/);
  assert.match(notes, /CPU idle 0\.00%/);
  assert.match(notes, /not the \*\*Source code\*\* archives/);
});

test('every work prefix opens a pull request, and only those', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'open-pull-request.yml'), 'utf8');
  const listed = [...workflow.matchAll(/^\s+- ([a-z]+)\/\*\*$/gm)].map(([, prefix]) => prefix);
  assert.deepEqual(listed, WORK_PREFIXES);
});

test('the bump branches stay out of the workflow that opens pull requests, because the bump opens its own', () => {
  assert.equal(WORK_PREFIXES.includes('bump'), false);
});

function versionFilesCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'clima-pro-version-'));
  for (const file of VERSION_FILES) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    copyFileSync(join(root, file), join(dir, file));
  }
  return dir;
}

test('raising the version changes every copy of it and nothing else', () => {
  const dir = versionFilesCopy();
  try {
    const before = manifestVersion(root);
    setVersion(dir, '9.8.7');
    assert.equal(manifestVersion(dir), '9.8.7');
    assert.deepEqual(versionMismatches(dir, '9.8.7'), []);
    for (const file of VERSION_FILES) {
      const changed = readFileSync(join(dir, file), 'utf8').split('\n');
      const original = readFileSync(join(root, file), 'utf8').split('\n');
      assert.equal(changed.length, original.length, file);
      const different = changed.filter((line, i) => line !== original[i]);
      assert.equal(different.length, file.endsWith('package-lock.json') ? 2 : 1, file);
      for (const line of different) assert.ok(line.includes('9.8.7'), `${file}: ${line}`);
    }
    assert.equal(JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages[''].version, '9.8.7');
    assert.deepEqual(versionMismatches(root, before), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file with another version is named', () => {
  const dir = versionFilesCopy();
  try {
    setVersion(dir, '9.8.7');
    assert.deepEqual(versionMismatches(dir, '9.8.7'), []);
    assert.equal(versionMismatches(dir, '1.0.0').length, VERSION_FILES.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const LCOV = [
  'TN:',
  'SF:com.ulanzi.climapro.ulanziPlugin\\plugin\\app.js',
  'FNF:4', 'FNH:2', 'BRF:10', 'BRH:5', 'LF:100', 'LH:50',
  'end_of_record',
  'SF:com.ulanzi.climapro.ulanziPlugin/plugin/view.js',
  'FNF:4', 'FNH:4', 'BRF:10', 'BRH:10', 'LF:100', 'LH:100',
  'end_of_record',
  'SF:com.ulanzi.climapro.ulanziPlugin/plugin/ulanzi-api/index.js',
  'FNF:9', 'FNH:0', 'BRF:9', 'BRH:0', 'LF:900', 'LH:0',
  'end_of_record',
  'SF:com.ulanzi.climapro.ulanziPlugin/plugin/render/glyphs/outfit.js',
  'LF:900', 'LH:0',
  'end_of_record',
  'SF:com.ulanzi.climapro.ulanziPlugin/node_modules/ws/index.js',
  'LF:900', 'LH:0',
  'end_of_record',
  'SF:test/view.test.mjs',
  'LF:900', 'LH:0',
  'end_of_record',
].join('\r\n');

test('coverage counts the plugin code of this project, not the SDK, outlines, dependencies or tests', () => {
  const own = ownFiles(parseLcov(LCOV));
  assert.equal(own.length, 2);
  assert.deepEqual(totals(own), { lines: 75, branches: 75, functions: 75 });
});

test('coverage below a floor is named, and at the floor passes', () => {
  const measured = { lines: 75, branches: 60, functions: 75 };
  assert.deepEqual(belowFloors(measured, { lines: 75, branches: 75, functions: 50 }), ['branches coverage is 60.0%, below the floor of 75%']);
  assert.deepEqual(belowFloors(measured, { lines: 75, branches: 60, functions: 75 }), []);
});
