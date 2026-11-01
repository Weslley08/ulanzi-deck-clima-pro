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

An earlier version lost the saved key at each start. Studio's log now has one of these lines, which never include the key: `Studio sent a saved API key`, `Studio has no API key saved` or `Studio did not answer about the saved API key`.

- [ ] Pasting a valid key shows "Connected" with the place, and the device shows the weather
- [ ] A wrong key shows the rejection in the panel and "Check your API key" on the device
- [ ] A second key on the deck already has the API key filled in
- [ ] After closing and reopening Studio, the key is still saved and the weather returns by itself, without opening the panel
- [ ] After installing a new version over an old one, the weather returns by itself, without opening the panel
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

## Place

- [ ] Typing a name shared by several places lists each one with its state
- [ ] A place chosen from the list shows the same state in the panel after restarting Studio

## Updates

The polling relies on `last_updated` moving in steps of about 15 minutes. That comes from WeatherAPI.com's "every 10-15 minute" and from saved replies, not from watching the live API.

- [ ] `WEATHERAPI_KEY=xxx npm run watch:updates` shows steps of about 15 minutes. If it does not, change `UPDATE_DUE_MS` in `weather-hub.js`
- [ ] With a key on screen, the weather changes within a few minutes of `last_updated` moving

## Defesa Civil alerts

`npm run test:live:alerts` checks the real feed first and lists the alerts in force. A real alert cannot be ordered, so to test the states, pick a place from that list. For a state not listed right now, wait for a stormy day. Disconnecting from the internet covers the failure states.

- [ ] A place in Brazil with no alert looks exactly as it did before: no mark and no smaller forecast
- [ ] A place outside Brazil never downloads the feed, and its key looks as usual. In the panel, the Defesa Civil option is greyed out as Off, with a warning that says why and which country was found
- [ ] Choosing a place in Brazil again brings the option back as it was, and alerts return without restarting Studio
- [ ] With an alert over the place, the temperature, condition and city stay readable **on the device**, on every theme, on both screens
- [ ] `DEFESA CIVIL — SEVERO` and `DEFESA CIVIL — EXTREMO` can be read at arm's length. If they cannot, the text is about 10 px and `BAND_TEXT_MAX` in `alert-layer.js` is the place to start
- [ ] The extreme frame's glow looks slow and steady on the device, without flashing, and the keys stay responsive. It sends one image a second
- [ ] One press opens the alert, on the D200H too, and the next press moves on
- [ ] An alert page goes back to the forecast after 30 seconds. After restarting Studio, the key starts on the forecast
- [ ] The panel shows the full text, with accents. "Orientações oficiais" opens in the browser
- [ ] Changing the place removes the old place's alerts at once
- [ ] Without internet, the weather carries on, and after 15 minutes the hollow sign appears and the panel says the check is getting old. No message on the key or the panel claims there are no alerts
- [ ] When the connection returns, the sign goes away by itself
- [ ] With **Defesa Civil alerts** set to **Off** on every key, the system monitor shows no more 7 MB downloads
- [ ] An alert ends at its time, without a new download

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
