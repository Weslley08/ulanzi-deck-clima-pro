# Manual check on a real device

CI cannot see the device. Run this in Ulanzi Studio before publishing each release, and record the result in the release notes. Pushing an image gets no reply from the device, so a lost frame looks exactly like a drawn one: look at the keys, not just the preview in Studio.

Setup: run `npm run package`, unzip the result into the plugins folder (`%APPDATA%\Ulanzi\UlanziDeck\Plugins\` or `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`), and restart Studio. To see logs, start Studio with `--log --nodeRemoteDebug`. The plugin writes `[Clima Pro]` lines there: its arguments at startup, each connection, each kind of failure, and why it stopped. `exitCode=1` means it failed, and `exitCode=0` means it was asked to stop.

## First run

- [ ] The plugin and the **Weather** action appear in Studio, with the right icon and name
- [ ] On a new key, the device shows "Add your API key" after at most 3 seconds
- [ ] Pressing that key shows Studio's alert
- [ ] The settings panel has a dark background, readable labels and all six theme pictures
- [ ] "Get a free key" and "WeatherAPI.com" open in the browser, not inside the panel
- [ ] The credit and the disclaimer are visible without any extra click

## API key (global settings)

This has never run on a real host, because the official simulator crashes on it.

- [ ] Pasting a valid key shows "Connected" with the place, and the device shows the weather
- [ ] A wrong key shows the rejection in the panel and "Check your API key" on the device
- [ ] A second key on the deck already has the API key filled in
- [ ] After closing and reopening Studio, the key is still saved and the weather returns by itself
- [ ] After exporting a profile, the API key is not in the exported file

## Display

- [ ] The weather appears **on the device**, not just in Studio's preview
- [ ] Each theme looks right on the device, for both screens
- [ ] Text is sharp and big enough at arm's length, on every theme
- [ ] A long city name fits, and a place with accents (São Paulo, Reykjavík) draws correctly
- [ ] Temperatures, wind and precipitation look right in °C and °F

## Press

- [ ] One press moves one screen: now, details, now
- [ ] On the D200H, one touch still moves only one screen
- [ ] The screen is kept after restarting Studio
- [ ] The Screen selector in an open panel follows the press

## Updates

The polling relies on `last_updated` moving in steps of about 15 minutes. That comes from WeatherAPI.com's "every 10-15 minute" and from saved replies, not from watching the live API.

- [ ] `WEATHERAPI_KEY=xxx npm run watch:updates` shows steps of about 15 minutes. If it does not, change `UPDATE_DUE_MS` in `weather-hub.js`
- [ ] With a key on screen, the weather changes within a few minutes of `last_updated` moving

## Life cycle

- [ ] Going to another page and back redraws the key at once
- [ ] Unplugging and replugging the device redraws the keys
- [ ] Removing the key stops its updates
- [ ] Without internet, the key keeps the data with a dot in the corner, then "No connection" after 60 minutes
- [ ] When the connection returns, the weather comes back by itself
- [ ] Quitting Studio leaves no `node` process of this plugin running after about 3 minutes, the time it spends retrying the connection

## Performance

- [ ] `npm run measure`: record the numbers in the release notes
- [ ] With 6 keys, Studio's Node process stays near 0% CPU between updates in the system monitor
