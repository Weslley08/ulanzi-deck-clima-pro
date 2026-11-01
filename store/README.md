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

Live weather on your keys, in the theme you choose. Six themes, current conditions, details and a 3-day forecast. Uses your own free WeatherAPI.com key.

**Details (1000 characters at most):**

Show current conditions, details and a 3-day forecast on your deck, with six themes to choose from: Sky, Minimal, Thermal, LCD, Neon and Almanac. Press a key to switch screens.

Setup: create a free key at weatherapi.com, paste it into the settings panel, and pick a place and a theme.

Weather data by WeatherAPI.com. Weather information displayed here is provided for general informational purposes only. Forecasts and conditions are probabilistic and may not be accurate for your specific location or time. This data should not be used as the sole basis for decisions involving personal safety, aviation, marine navigation, emergency planning, or other safety-critical activities. Always consult official meteorological services and relevant authorities for decisions where accuracy is critical.

Open source, Apache-2.0.

## Before submitting

- [x] The UUID `com.ulanzi.climapro.ulanziPlugin` is confirmed by the maintainer. **It can never change after publishing.** Known risk: `com.ulanzi.` is Ulanzi's own namespace and guideline 1.3 asks for the author's organization name in the UUID, so review may refuse it.
- [ ] The status note at the top of the main README is removed
- [ ] No plugin named Clima Pro exists on the marketplace (could not be checked from outside the site)
- [ ] The store's terms of use were read. They were not available publicly when this was written.
- [ ] [docs/VERIFY.md](../docs/VERIFY.md) passed on a real device
- [ ] `npm run verify:package` passes, and the Auto check panel on the form is all green
- [ ] Copyright lines are on the store page or the repository, not in the settings panel
