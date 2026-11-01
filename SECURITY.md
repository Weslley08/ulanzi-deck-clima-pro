# Security

## Reporting a problem

Use [GitHub's private report](https://github.com/Weslley08/ulanzi-deck-clima-pro/security/advisories/new), not a public issue.

If your WeatherAPI.com key was exposed, replace it in your WeatherAPI.com account or contact support@weatherapi.com. This project has no access to your account.

## What the plugin does with your data

- Your API key is stored by Ulanzi Studio in the plugin's global settings. Studio's storage is not documented as encrypted, so treat it as you would any local configuration file.
- The key and the location you chose are sent only to `api.weatherapi.com`, over HTTPS. If you leave the location empty, WeatherAPI.com works it out from your IP address.
- For a place in Brazil, the plugin also downloads the public Defesa Civil alert feed from `idapfile.mdr.gov.br`, over HTTPS, unless you turn alerts off. The request carries neither your key nor your place, and the matching happens on your machine, but that server sees your IP address as any other would.
- Weather data is kept in memory for at most 60 minutes and is never written to disk. Alerts are kept in memory only.
- The plugin has no telemetry, opens no ports and contacts no other server.

## How it is checked

Every pull request and release runs `npm audit`, dependency review, CodeQL, a secret scan of the repository and of the final zip, and an integrity check of the bundled SDK. The same scan runs every week to catch problems found after a release, and Dependabot proposes updates.

These tools only find problems that are already known. Passing them does not prove the plugin has no vulnerabilities.

## Known limits

**Runtime.** Ulanzi Studio runs plugins on the Node.js it bundles, reported as v20.12.2. That version is past end of life and has known vulnerabilities, and a plugin cannot change it. To limit the exposure, Clima Pro opens no listening socket, runs no child processes, reads no user files, talks to two fixed HTTPS hosts, refuses redirects, and treats everything from them as data. Only Ulanzi can update the runtime.

**Alert content.** The plugin shows what the official feed publishes and has no way to tell a false alert from a real one. False alerts have been sent through compromised Defesa Civil accounts in the past. Text from the feed only selects letter shapes on the key and is set as plain text in the panel, so it cannot inject markup, and the panel only opens `https` links from it.

**Bundled SDK.** The Ulanzi SDK is copied into the plugin, outside the reach of `npm audit` and Dependabot. It is pinned to reviewed commits in `sdk-lock.json`, and the weekly check reports upstream changes for a person to review.

**Local access.** Anything running as your user can read Studio's settings and connect to Studio's local socket. The plugin cannot protect against malware already on the machine.
