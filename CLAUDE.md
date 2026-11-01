# ulanzi-deck-clima-pro

Clima Pro, a weather plugin for Ulanzi Studio with selectable themes, using WeatherAPI.com. Use the `ulanzi-plugin` skill for anything about the SDK, host or store.

## Permanent requirements (set by the maintainer)

1. **Performance:** optimize to spare the user's device. Measure CPU and memory before each release (`npm run measure`) and report the numbers.
2. **Store compliance:** follow all marketplace policies and terms. Reread them before each submission, and never claim compliance with text nobody has read.
3. **Open source:** public repository, test pipeline, push validation, issue templates, simple fork flow.
4. **No known vulnerabilities ship:** blocking checks on PRs and releases, plus a weekly scan. Scanners only find known problems, so never present a green check as proof of safety.

Confirm with the maintainer before creating the public repository, a release, or a store submission. The UUID is fixed after publishing.

## Commands

Run everything on Node 20.12.2 (`.nvmrc`), the version Studio runs plugins on. `npm run setup`, then `npm test`. See CONTRIBUTING.md for the rest.

## Things that are easy to break

- The API key may only appear in `weather-api.js` URLs. Never log it, never put it in per-key settings. `host.js` exists because the SDK logs every message. `report()` in `app.js` is the only output that reaches Studio's log, so never pass it settings or URLs.
- The main service must pass a key's context to `getGlobalSettings`, as the SDK says. The panel does not need one, so a panel that shows the saved key does not prove the plugin got it.
- `libs/` and `plugin/ulanzi-api/` are verbatim SDK copies pinned in `sdk-lock.json`. Extend in `host.js`; do not edit them.
- Key images must be full data URIs. Devices silently ignore bare base64, and Studio's preview hides the bug.
- Handle only `run` for presses: the D200H fires `keydown` and `run` for one touch.
- Current conditions may not be kept over 60 minutes (WeatherAPI.com terms). The credit and disclaimer in the panel and the store text are also required by those terms.
- The plugin shows current conditions only, and `last_updated` sets when it asks next, so users get no refresh setting. The maintainer asked for both.
- An alert never replaces the forecast by itself, and a failed check never reads as "no alerts". `docs/DEFESA-CIVIL.md` records the source, what was seen in it and its limits. The feed weighs 3 to 7 MB or more and has no documentation, so do not read it whole into memory, and keep `test:live:alerts` passing. It is a 12 hour window, not a list of 40. It uses `node:https` and not `fetch` because of the memory that costs.
- Merging into `main` publishes a release, and the only human checks left are the boxes in that pull request. Customers read the notes in the Community Store, so publishing refuses a draft whose top was not written by a person, and a version below the newest tag. The flow is in `scripts/flow.mjs` and `scripts/lib/flow.mjs`, and CONTRIBUTING.md explains it. Its pull requests must use `AUTOMATION_TOKEN`: one opened with the workflow's token leaves CI waiting for a manual approval. Those jobs must not run npm, so nothing from a dependency runs next to the token.

- The plugin is listed on the unofficial Community Store, so every release marked `latest` reaches its users as an update with no further review. Its page reads `store.json` and `en.json` from `main`, and `store/README.md` explains which text shows when.

## What has not been verified

On 2026-11-01 the maintainer got it working in the real Ulanzi Studio (Node 20.12.2) with a key, but after each update had to erase and retype the key. The cause is probably `getGlobalSettings` sent without a context, fixed in 1.3.0 but not yet seen working in Studio. An earlier stop with `exitCode=0` was never explained; the `[Clima Pro]` lines in Studio's log now say why it stops and what Studio answered about the key. The full checklist has not been run. `docs/VERIFY.md` is the checklist for the first real run. `npm run test:live` and `npm run watch:updates` need a key. The 15 minute step in `last_updated` comes from WeatherAPI.com's "every 10-15 minute" and 97 saved replies in public repositories, not from watching the live API.

The Defesa Civil alerts have not run in Studio or on a device. Their feed was read and watched live for 45 minutes on 2026-11-01, but no `Update` or `Cancel` entry has ever been seen, so those are tested only with synthetic feeds. Whether alerts sent only by cell broadcast reach the feed is unknown.

The branch flow has not completed a cycle on GitHub. `flow.mjs` is tested with a real git and canned `gh` replies, so what GitHub itself does (auto-merge, the required checks on `release/v*`, publishing) is only seen on a real run.
