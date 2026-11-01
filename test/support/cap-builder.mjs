// Builds SYNTHETIC IDAP feeds: invented alerts in the shape of the real entries saved in
// test/fixtures/idap-feed.xml. None of this came from the Defesa Civil. It exists for what the saved
// feed never contained, such as updates and cancellations, whose shape comes from the CAP 1.2 standard.

export const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** A closed ring around a point, in CAP's `lat,lon lat,lon` form. */
export const square = (lat, lon, radius = 0.2) => [
  [lat - radius, lon - radius],
  [lat - radius, lon + radius],
  [lat + radius, lon + radius],
  [lat + radius, lon - radius],
  [lat - radius, lon - radius],
].map((pair) => pair.join(',')).join(' ');

// null leaves a field out even where it has a default.
const optional = (name, value) => (value === undefined || value === null ? '' : `<${name}>${value}</${name}>`);

export function capEntry({
  id = '900001/2026',
  sender = 'CENAD-SEDEC',
  sent,
  status = 'Actual',
  msgType = 'Alert',
  source = 'Defesa Civil',
  scope = 'Public',
  references,
  event = 'CHUVAS INTENSAS',
  urgency = 'Immediate',
  severity = 'Severe',
  effective,
  onset,
  expires,
  senderName = 'Defesa Civil Sintética',
  headline = 'Defesa Civil:Alerta sintetico',
  description = `Alerta sintético ${id}`,
  instruction = 'Instrução sintética.',
  web = 'https://www.gov.br/mdr/pt-br/assuntos/protecao-e-defesa-civil/saiba-como-agir',
  areaDesc = 'Blumenau/SC',
  polygons = [],
  geocodes = [],
} = {}) {
  return `<entry><title>${event}</title><author><name /></author><id>${id}</id><updated>${sent}</updated><content type="text/xml"><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">`
    + `<identifier>${id}</identifier><sender>${sender}</sender><sent>${sent}</sent><status>${status}</status><msgType>${msgType}</msgType>`
    + `${optional('source', source)}<scope>${scope}</scope>${optional('references', references)}`
    + `<info><language>pt-BR</language><category>Met</category><event>${event}</event><responseType>Execute</responseType><urgency>${urgency}</urgency><severity>${severity}</severity><certainty>Likely</certainty>`
    + `${optional('effective', effective)}${optional('onset', onset)}${optional('expires', expires)}<senderName>${senderName}</senderName><headline>${headline}</headline>`
    + `${optional('description', description)}${optional('instruction', instruction)}${optional('web', web)}<contact>+55 00 0000-0000</contact>`
    + `<area><areaDesc>${areaDesc}</areaDesc>${polygons.map((polygon) => `<polygon>${polygon}</polygon>`).join('')}`
    + `${geocodes.map((code) => `<geocode><valueName>IBGE</valueName><value>${code}</value></geocode>`).join('')}</area>`
    + '</info></alert></content></entry>';
}

export const capFeed = (entries, updated = '2026-11-01T12:00:00Z') => '<?xml version="1.0" encoding="UTF-8"?>\n'
  + `<feed xmlns="http://www.w3.org/2005/Atom"><title>Rss Idap</title><id>http://example.invalid/synthetic</id><updated>${updated}</updated>${entries.join('')}</feed>\n`;
