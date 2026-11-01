# Defesa Civil alerts: source and limits

Clima Pro shows official alerts from Brazil's Defesa Civil on top of the forecast. This records where they come from, what was checked, and what the plugin cannot promise.

**This does not replace official channels.** A key with no alert on it never means there is no danger.

## Source

| | |
|---|---|
| **Feed** | `https://idapfile.mdr.gov.br/idap/api/rss/cap` |
| **System** | IDAP (Interface de Divulgação de Alertas Públicos), run by the Secretaria Nacional de Proteção e Defesa Civil |
| **Format** | An Atom document with one CAP 1.2 alert in each entry |
| **Legal basis** | Portaria MIDR nº 2.458 of 30 July 2026, art. 10: alerts are stored as CAP and "devendo permanecer públicos para consulta" |
| **Used for** | Only entries with `status=Actual`, `scope=Public`, and "Defesa Civil" in `source` or `senderName` |

The Portaria says nothing about feeds, APIs or reuse by third parties, and this feed has no published documentation or terms that we could find. The address came from the World Meteorological Organization's register of alerting authorities, as given by the maintainer. `idap.mdr.gov.br`, the portal, did not resolve from here on 2026-11-01. **Before a store submission, ask the Defesa Civil whether this use is acceptable.**

INMET warnings, forecasts and any other source are deliberately not used, and INMET's yellow, orange and red are never converted into Defesa Civil levels.

## What was observed

All from the live feed on 2026-11-01, a quiet Sunday morning in Brazil, with 40 entries saved and the feed watched for 45 minutes. **Nothing here is documented by the source, so it can change.** `npm run test:live:alerts` checks these assumptions against the live feed.

| Finding | What the plugin does about it |
|---|---|
| 7 MB, then 2.7 MB an hour later when one large entry aged out, with no compression, ETag, Last-Modified or Range. Nearly all of it is polygon coordinates, so the size follows recent alerts. | Reads it as a stream, through `node:https`, which raised memory by 8 MB on a read against 22 to 27 MB for `fetch`. Skips the polygons of expired alerts and packs the others into typed arrays. |
| `X-Feed-Cache: NGINX - 5 minutes`, and `<updated>` moved every 303 to 308 s in all 45 samples, with no errors. | Checks about 5 min 20 s after `<updated>`. The 2 minutes first suggested would download the same bytes. |
| `<updated>` comes in the first bytes, and the server can answer with the old copy while it regenerates (`X-Cache-Status: STALE`). | If it matches the version last read, closes the connection and checks again in a minute. That costs about 16 KB and 30 ms. |
| No entry changed while it stayed in the feed, and **no new entry was published during the watch**, so one arriving was never seen. | Reads the whole feed for each new version instead of relying on a shortcut. |
| Entries leave the feed 12 hours after `sent`, oldest first. It is a time window, not a list of 40, even though there happened to be 40. | Keeps a valid alert that aged out until it expires. Treats one that vanished from inside the window as withdrawn. |
| Every entry has a polygon, and only 16 of 40 have IBGE codes. State-labelled entries, such as `SÃO PAULO/SP`, cover only the drawn area. | Matches the place's coordinates against the polygons. |
| All 60 municipal seats named by IBGE code fell inside their alert's polygons, checked against a public table of seats. | Trusts the polygons. IBGE codes are kept but not matched, because WeatherAPI.com gives no code for the place. |
| `severity` was `Severe` 28 times, `Moderate` 11 times and `Extreme` once. | Shows all of them. See the levels below. |
| `CHANNEL-LIST` was `Google` on every entry. | See the limits below. |
| No `Update`, `Cancel` or `<references>` in any entry, and no `effective`. | Handles them as CAP 1.2 specifies, **tested only with synthetic feeds**. |

## How a place is matched

There is no second place to configure. The alert context comes from the place in the weather reply: its `lat`, `lon`, `name`, `region` and `country`.

1. Outside Brazil, the feature is off, because the feed cannot cover the place. Nothing is downloaded, scheduled or kept in memory, and the key looks as usual. The panel greys out the option as Off and says why, with the country found. A reply with no country counts as outside, since it cannot be confirmed as Brazil. The key's own choice is kept and comes back with a place in Brazil.
2. If the alert has a polygon and the place has coordinates, the polygon decides.
3. Otherwise the name and the state must both match, so `Bom Jesus/RS` does not reach Bom Jesus in Piauí. A name equal to the state's reaches the whole state.

## Levels

The feed's CAP `severity` is shown as published.

| CAP | On the key |
|---|---|
| `Extreme` | Red frame with a slow glow, and the banner `DEFESA CIVIL — EXTREMO` |
| `Severe` | Orange frame, and the banner `DEFESA CIVIL — SEVERO` |
| `Moderate`, `Minor`, anything else | A small yellow sign in the corner, and the full text behind a press |

The Portaria's art. 12 has five levels (Baixo, Moderado, Alto, Severo, Extremo), and CAP has four. **The feed does not say how they map, and they may not match:** the one `Extreme` entry seen was issued as "risco ALTO" with `urgency=Expected`, although the Portaria reserves Extremo for imminent risk. The plugin does not try to correct this.

`Moderate` was not in the original request, which had only severe and extreme. It is 11 of 40 entries and was the only alert in force when the feed was first read, so hiding it would leave a real official alert invisible. A small mark was the lightest way to show it.

## Limits of the coverage

- **Not every alert may be in the feed.** Art. 13 lists Google, SMS, pay TV, Telegram, WhatsApp and Defesa Civil Alerta (cell broadcast) as channels, and every entry seen listed only Google. Whether an alert sent only by cell broadcast or SMS reaches this feed is unknown, and could not be tested without one happening. **Do not assume that a phone alert will appear here.**
- **The place is a point.** WeatherAPI.com gives one coordinate per place, usually the town center, and it does not separate neighbourhoods. A polygon drawn over part of a large city can miss that point, and a user near the edge can be affected without the key showing it. With "Detect from my IP", the point can be far from the user.
- **Delay.** An alert can take about 5 minutes to reach the feed and about 5 more to reach the key. Severe alerts can have as little as two hours of lead time (art. 12, IV), and phones get them sooner.
- **A false alert stays false.** In a reported incident, compromised accounts sent false alerts through IDAP. The plugin shows what the official feed publishes and cannot tell the difference.
- **The clock.** Times are judged by the server's `Date` header, so a wrong clock on the user's machine does not change what is in force.

## Failure is not the same as no alerts

| State | Meaning | On the key |
|---|---|---|
| `clear` | The source produced an answer in the last 15 minutes, and no alert in it reaches this place | The normal forecast |
| `active` | At least one alert reaches this place | Mark or banner |
| `stale` | The newest answer is over 15 minutes old | A small hollow sign in the corner |
| `unavailable` | No answer ever, or none in the last 60 minutes. This never means there are no alerts. | The same hollow sign |

Age counts from the feed's own `<updated>`, so a server stuck on an old copy also ends up `stale`. Known alerts are kept through a failure until their own expiry, and never after it. The weather and the alerts never wait for each other, and the forecast stays when the feed is down.

## What it costs the user

- **Data:** a key on screen downloads the feed every 5 minutes. At the 3 to 7 MB seen on a quiet day, that is 35 to 85 MB an hour, or 0.8 to 2 GB if left on around the clock, and a stormy day with many large alerts would cost more. The server offers no way to reduce this. Keys share one download, and nothing downloads while no key in Brazil is on screen. Each key has an **Off** setting for this reason.
- **Privacy:** the request carries nothing about the user or the place. Matching happens on the machine.
- **CPU and memory:** see `npm run measure`.
