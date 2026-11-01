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

- The API key may only appear in `weather-api.js` URLs. Never log it, never put it in per-key settings. `host.js` exists because the SDK logs every message.
- `libs/` and `plugin/ulanzi-api/` are verbatim SDK copies pinned in `sdk-lock.json`. Extend in `host.js`; do not edit them.
- Key images must be full data URIs. Devices silently ignore bare base64, and Studio's preview hides the bug.
- Handle only `run` for presses: the D200H fires `keydown` and `run` for one touch.
- Current conditions may not be kept over 60 minutes (WeatherAPI.com terms). The credit and disclaimer in the panel and the store text are also required by those terms.

## What has not been verified

Nothing has run in the real Ulanzi Studio or on a device, or against the live API with a valid key. `docs/VERIFY.md` is the checklist for the first real run. `npm run test:live` needs a key.
