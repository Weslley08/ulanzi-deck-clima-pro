# Contributing

You do not need a Ulanzi device to contribute. The tests run the real plugin and the real Ulanzi SDK against a fake host, and the settings panel runs in a real browser.

## Start

Fork the repository, then:

```bash
git clone https://github.com/<you>/ulanzi-deck-clima-pro.git
cd ulanzi-deck-clima-pro
nvm use          # Node 20.12.2, the version Ulanzi Studio runs plugins on
npm run setup
npm test
```

No WeatherAPI.com key is needed. The tests use canned replies, and pull requests from forks run the same checks without any secret.

Open a pull request against `main`. CI runs the tests on Windows, macOS and Linux, builds the zip and checks it. Keep each pull request to one change.

## Commands

| Command | What it does |
|---|---|
| `npm test` | All tests. The panel tests skip if no Chromium is installed; set `CHROME_PATH` to use one. |
| `npm run typecheck` | Checks the Defesa Civil modules against `alert-types.d.ts`. Nothing is built: the plugin is plain JavaScript. |
| `npm run test:live:alerts` | Checks our assumptions against the real Defesa Civil feed and lists the alerts in force. Needs no key, and downloads the feed a few times, several MB each. |
| `npm run build:assets` | Regenerates theme pictures, icons, store art and `docs/themes.png`. |
| `npm run build:glyphs` | Regenerates font outlines. Only needed for a new font or character. |
| `npm run package` | Builds `dist/com.ulanzi.climapro.ulanziPlugin.zip`. |
| `npm run verify:package` | Checks the zip against the store checklist and starts the plugin from it. |
| `npm run measure` | CPU and memory use. Include the numbers if your change could affect them. |
| `npm run check:secrets`, `check:sdk`, `audit` | The security checks CI runs. |
| `WEATHERAPI_KEY=xxx npm run test:live` | Checks our assumptions against the real API, using your own key. |
| `WEATHERAPI_KEY=xxx npm run watch:updates -- London 60` | Shows how often `last_updated` moves. Spends one call a minute of your plan. |

## Adding a theme

This is the easiest way to contribute. A theme is one file that draws SVG.

1. Create `plugin/render/themes/mytheme.js`:

   ```js
   import { Theme } from '../theme.js';

   export default class MyTheme extends Theme {
     id = 'mytheme';
     fonts = { big: 'outfit-700', label: 'outfit-500' };

     palette() {
       return { bg: '#102030', ink: '#FFFFFF', sub: '#9FB3C8', accent: '#FFD24A' };
     }

     iconStyle() {
       return { mode: 'stroke', strokeWidth: 3, knockout: '#102030', colors: { /* see minimal.js */ } };
     }
   }
   ```

   That is enough for both screens. Override `now`, `details` or `background` for your own layout.
2. Register it in `plugin/render/themes/index.js`.
3. Add it to the gallery in `property-inspector/weather/inspector.html`, and its name to every language file.
4. Run `npm run build:assets`, then look at your row in `docs/themes.png`.
5. Run `npm test`. It draws every condition, screen and extreme value in your theme and fails on anything broken.

Keep text as drawn outlines through `this.label` and `this.bigTemp`. That is what stops a place name from the API from injecting markup, and it means the plugin needs no fonts at runtime.

Fonts must have a license that allows bundling, recorded in `THIRD_PARTY_NOTICES.md`.

## Rules the code depends on

- **The API key stays out of logs, errors, URLs we print and per-key settings.** Only `weather-api.js` puts it in a URL. It is saved in global settings because a key's own settings could travel in a shared profile.
- **Spend the user's machine and quota carefully.** Nothing polls while no key is on screen, keys showing one place share one request, and an unchanged image is not sent again. The API's `last_updated` sets when to ask next, so there is no refresh setting.
- **Weather data lives in memory for at most 60 minutes.** WeatherAPI.com's terms set that limit on current conditions.
- **Every failed press calls `showAlert`.** The store guidelines require it.
- **An alert never replaces the forecast by itself, and a failed check never reads as "no alerts".** Only Defesa Civil entries from the IDAP feed count. See [docs/DEFESA-CIVIL.md](docs/DEFESA-CIVIL.md).
- **Do not edit `libs/` or `plugin/ulanzi-api/`.** They are verbatim copies of the Ulanzi SDK pinned in `sdk-lock.json`, and CI fails if they change. To update them, review the upstream diff, copy the files, run `node scripts/check-sdk.mjs --write`, and update the commits in the lock file.
- **Runtime dependencies need a good reason.** Each one ships to every user. No install scripts and no native binaries.

## Trying it for real

**On a device**, follow [docs/VERIFY.md](docs/VERIFY.md).

**In the official simulator**, note that as of commit `550ab80` it crashes when a plugin uses global settings, because of two undefined variables in `UlanziDeckSimulator/server/clients.js`. Fix your local copy by adding one line at the start of each handler:

```js
if(data.cmd === 'setGlobalSettings'){
  const context = utils.encodeContext(data); const oldParam = data.settings;   // add this
  ...
if(data.cmd === 'getGlobalSettings'){
  const context = utils.encodeContext(data); const { uuid, actionid, key } = data;   // add this
```

Then copy the plugin folder into the simulator's `plugins/` folder and start the main service with the simulator's port:

```bash
node plugin/app.js 127.0.0.1 39069 en
```

## Releasing

A tag, its release and the plugin all carry the same number. `Version` in `manifest.json` is the source: the settings panel shows it at the bottom as `Clima Pro v1.2.3`, so a user can tell which release they run. A test fails if either `package.json` disagrees, and the release workflow fails if the tag does.

1. In a pull request, raise the version in `manifest.json` and both `package.json` files, following semantic versioning.
2. After it merges, tag that commit on `main`:

   ```bash
   git tag -a v1.2.3 -m "Clima Pro 1.2.3"
   git push origin v1.2.3
   ```

3. The release workflow repeats every check and creates a draft release with the zip and its checksum.
4. Test that zip with [docs/VERIFY.md](docs/VERIFY.md), run `npm run measure`, and put both results in the release notes.
5. Publish the draft. If the manual check fails, fix it and release a new number instead of moving the tag.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
