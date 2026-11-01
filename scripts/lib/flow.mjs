// The rules of the branch flow, apart from git and gh so that they can be tested:
// a work branch -> develop -> release/vX.Y.Z -> main. See "How a change ships" in CONTRIBUTING.md.

export const DEVELOP = 'develop';
export const MAIN = 'main';

/** Pushing a branch with one of these prefixes opens its pull request. Keep in step with open-pull-request.yml. */
export const WORK_PREFIXES = ['feature', 'feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'ci', 'build', 'perf'];
const NEW_FEATURE_PREFIXES = new Set(['feature', 'feat']);

const VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_BRANCH = /^release\/v(\d+\.\d+\.\d+)$/;
// What GitHub writes when a pull request merges, from this repository or from a fork.
const MERGE_SUBJECT = /^Merge pull request #\d+ from [^/\s]+\/(\S+)$/;
// The box in the pull request to main. Merging there publishes, and CI cannot see the device.
const DEVICE_CHECK = /^\s*[-*]\s*\[[xX]\].*docs\/VERIFY\.md/m;

export const releaseBranch = (version) => `release/v${version}`;
export const bumpBranch = (version) => `bump/v${version}`;
export const versionOfReleaseBranch = (branch) => RELEASE_BRANCH.exec(branch)?.[1] ?? null;
export const isVersion = (text) => VERSION.test(text);

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Keeps real version tags, lowest first, without the v. A mistyped v.1.4.0 is not a version. */
export const versionTags = (tags) => tags
  .filter((tag) => tag.startsWith('v') && isVersion(tag.slice(1)))
  .map((tag) => tag.slice(1))
  .sort(compareVersions);

export const mergedBranches = (subjects) => subjects.flatMap((subject) => MERGE_SUBJECT.exec(subject)?.[1] ?? []);

/** A new feature raises the second number and anything else the third. A bigger jump is made by hand. */
export function nextVersion(last, branches) {
  const [major, minor, patch] = last.split('.').map(Number);
  const hasFeature = branches.some((branch) => NEW_FEATURE_PREFIXES.has(branch.split('/')[0]));
  return hasFeature ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/**
 * What a push to develop leads to. A version that already has a tag cannot be released again, and one
 * below what the merged branches call for would hide a new feature in a patch.
 * @returns {{idle: true} | {bump: string} | {release: string}}
 */
export function planDevelop({ version, tags, branches }) {
  const last = tags.at(-1);
  if (!last) return { release: version };
  if (!branches.length && tags.includes(version)) return { idle: true };
  const wanted = nextVersion(last, branches);
  return compareVersions(version, wanted) >= 0 ? { release: version } : { bump: wanted };
}

/** @returns {string | null} why this pull request may not merge */
export function flowProblem({ base, head, sameRepo, version, body }) {
  const headRelease = sameRepo ? versionOfReleaseBranch(head) : null;
  if (base === DEVELOP) {
    return headRelease ? `Nothing flows back from ${head}: a release branch only holds what came from ${DEVELOP}.` : null;
  }
  const baseRelease = versionOfReleaseBranch(base);
  if (baseRelease) {
    if (!sameRepo || head !== DEVELOP) return `A pull request to ${base} must come from ${DEVELOP}.`;
    return version === baseRelease ? null : `${DEVELOP} says version ${version}, so it cannot go to ${base}.`;
  }
  if (base === MAIN) {
    if (!headRelease) return `A pull request to ${MAIN} must come from a release/vX.Y.Z branch. Change the base of this one to ${DEVELOP}.`;
    if (version !== headRelease) return `${head} says version ${version}.`;
    return DEVICE_CHECK.test(body ?? '') ? null : 'Merging publishes the release. Run docs/VERIFY.md on a device, then tick its box in the description.';
  }
  return null;
}

/** The first commit says what the branch is for, and the template keeps its checklists. */
export function workPullRequest({ branch, subjects, template }) {
  const commits = subjects.map((subject) => `- ${subject}`).join('\n');
  return {
    title: subjects[0] ?? branch,
    body: template.replace(/<!--[\s\S]*?-->/, commits),
  };
}

export function bumpPullRequest(version) {
  return {
    title: `Raise the version to ${version}`,
    body: `What was merged into \`${DEVELOP}\` needs a new version. This merges by itself once the checks pass, and then the pull request for \`${releaseBranch(version)}\` opens.\n\nFor a different number, close this and run \`npm run bump -- X.Y.Z\` in a branch.`,
  };
}

export function releasePullRequest({ version, branches }) {
  const list = branches.filter((branch) => !branch.startsWith('bump/')).map((branch) => `- \`${branch}\``).join('\n') || '- Nothing since the last release';
  return {
    title: `Release v${version}`,
    body: `Merging this is the approval to validate v${version}. GitHub does not let a person approve a pull request in their own name, so the merge is the approval.\n\n## What happens next\n\n1. The zip is built once, and it must start and draw a key on Windows and macOS\n2. The WeatherAPI.com and Defesa Civil tests run against the real services\n3. \`npm run measure\` runs\n4. If all of that passes, a draft release is created with the zip and the numbers, and a pull request to \`${MAIN}\` opens\n\nMore merges into \`${DEVELOP}\` join this pull request.\n\n## What goes in\n\n${list}`,
  };
}

export function mainPullRequest({ version, repository, commit, measure }) {
  return {
    title: `Publish v${version}`,
    body: `Merging this publishes the draft **Clima Pro ${version}** from [Releases](https://github.com/${repository}/releases) as the final release. It cannot be taken back: from then on it is what people download, and the community store reads it by itself.\n\n## Done automatically on ${commit}\n\n- Tests, coverage and the security checks\n- The zip started and drew a key on Windows and macOS\n- The WeatherAPI.com and Defesa Civil tests, against the real services\n\n\`\`\`\n${measure.trim()}\n\`\`\`\n\n## Before merging\n\nCI cannot see the device. A new merge into this branch validates again, replaces the draft and clears this box.\n\n- [ ] Ran docs/VERIFY.md on a real device with the zip from this draft, and put the result in its notes`,
  };
}

export function draftNotes({ repository, commit, changes, measure }) {
  return `${changes.trim()}\n\n## How far this has been tested\n\nCI ran the tests on Windows, macOS and Linux, started this zip on Windows and macOS against a fake host, and ran the WeatherAPI.com and Defesa Civil tests against the real services. [The manual checklist](https://github.com/${repository}/blob/${commit}/docs/VERIFY.md) has not been completed.\n\n## Install\n\n1. Download \`com.ulanzi.climapro.ulanziPlugin.zip\`, not the **Source code** archives, which do not include the dependencies and will not start. You can check it against \`SHA256SUMS.txt\`.\n2. Unzip it into the plugins folder:\n   - Windows: \`%APPDATA%\\Ulanzi\\UlanziDeck\\Plugins\\\`\n   - macOS: \`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/\`\n3. Restart Studio, drag **Weather** onto a key, and paste your [WeatherAPI.com key](https://www.weatherapi.com/signup) into the settings panel.\n\n## Performance\n\n\`npm run measure\` on a GitHub Windows runner, against a fake host rather than Studio:\n\n\`\`\`\n${measure.trim()}\n\`\`\``;
}
