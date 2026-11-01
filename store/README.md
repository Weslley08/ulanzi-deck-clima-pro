# Store listing

Text and art for the Ulanzi marketplace form. Generate the art with `npm run build:assets`.

Before each submission, read the current guidelines and the form again, because they change. Sources used here: `bbs.ulanzistudio.com/thread-23-1-1.html` and `thread-464-1-1.html`.

## Files

| Field | File | Size |
|---|---|---|
| Main work file | `dist/com.ulanzi.climapro.ulanziPlugin.zip` | 50 MB at most |
| Cover | `store/cover-2x1.png` or `store/cover-1x1.png` | The guide contradicts itself on 2:1 and 1:1, so check the form |
| Banner 01 | `com.ulanzi.climapro.ulanziPlugin/assets/banners/banner-1.png` | 1098×732, 3:2 |

## Fields

- **Name:** Clima Pro
- **Author:** the organization name registered on the marketplace (replace the login e-mail the form fills in)
- **Category:** Clima Pro
- **Additional link:** https://github.com/Weslley08/ulanzi-deck-clima-pro

**Summary (300 characters at most):**

Live weather on your keys, in the theme you choose. Six themes, with the latest conditions and details. Uses your own free WeatherAPI.com key.

**Details (1000 characters at most):**

Show the latest conditions and details on your deck, with six themes to choose from: Sky, Minimal, Thermal, LCD, Neon and Almanac. Press a key to switch screens.

In Brazil, official Defesa Civil alerts (IDAP feed) appear over the forecast. This does not replace official channels. It can be turned off, and it downloads several MB every 5 minutes.

Setup: create a free key at weatherapi.com, paste it into the settings panel, and pick a place and a theme.

Weather data by WeatherAPI.com. Weather information displayed here is provided for general informational purposes only. Forecasts and conditions are probabilistic and may not be accurate for your specific location or time. This data should not be used as the sole basis for decisions involving personal safety, aviation, marine navigation, emergency planning, or other safety-critical activities. Always consult official meteorological services and relevant authorities for decisions where accuracy is critical.

Open source, Apache-2.0.

## Before submitting

- [x] The UUID `com.ulanzi.climapro.ulanziPlugin` is confirmed by the maintainer. **It can never change after publishing.** Known risk: `com.ulanzi.` is Ulanzi's own namespace and guideline 1.3 asks for the author's organization name in the UUID, so review may refuse it.
- [ ] The status note at the top of the main README is removed
- [ ] No plugin named Clima Pro exists on the marketplace (could not be checked from outside the site)
- [ ] The store's terms of use were read. They were not available publicly when this was written.
- [ ] The Defesa Civil was asked whether reusing the IDAP feed this way is acceptable. It publishes no terms for it (see [docs/DEFESA-CIVIL.md](../docs/DEFESA-CIVIL.md))
- [ ] [docs/VERIFY.md](../docs/VERIFY.md) passed on a real device
- [ ] `npm run verify:package` passes, and the Auto check panel on the form is all green
- [ ] Copyright lines are on the store page or the repository, not in the settings panel

## Community Store

Everything above is for the official marketplace. Clima Pro is also on the unofficial [Ulanzi Community Store](https://ulanzicommunitystore.narlei.com), listed since 2026-11-01 ([issue #102](https://github.com/narlei/ulanzicommunitystore/issues/102)), so nothing needs submitting there again. Sources read for this: its `PUBLISHING.md`, `packages/catalog/bin/validate-pr.mjs` and `build-catalog.mjs`, and `pluginText` in its site and app. Read them again if the listing looks wrong, because they change.

- **Every release marked `latest` reaches its users as an update**, with no further review. Test before marking one.
- It rebuilds its catalog at least once a day from the default branch and the `latest` release. Text and art changes need no release, only a merge to `main`.
- [`store.json`](../store.json) at the root holds the cover, screenshots, long description and tags. A referenced image that does not exist rejects the listing, and a test checks that.
- **The store only shows `longDescription` in languages the plugin has no file for.** It knows `en`, `pt_BR`, `pt` and Chinese, and our `pt_PT.json` does not count as any of them. So:
  - In English it shows `Description` from `en.json`, which is why that text carries the credit and the short form of the disclaimer. The limit of 300 characters leaves no room for all of it.
  - In Portuguese and Chinese it shows `longDescription`, which is why that text starts in Portuguese, with English after it. It is plain text: line breaks show, Markdown does not.
- **Customers read the release notes, so write them for customers.** The app's *What changed* section ("Novidades" in Portuguese) shows the whole body of the `latest` release, and draws no tables or HTML. The site's [What's new](https://ulanzicommunitystore.narlei.com/updates/) page shows only the first three lines, up to 240 characters, and a heading counts as a line. So open with one sentence and two short bullets on what changes for the user, with no heading above them, and leave test results and measurements for the end, as a plain list.
- **It orders releases by the date they were published, not by version.** Publish them oldest first. If an older one is published last, the *What's new* page shows it as the current version.
