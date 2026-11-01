// Decides whether an alert reaches the user's place. WeatherAPI.com gives no IBGE code, and most feed
// entries give no IBGE code either, so coordinates against the alert's polygons are what can be
// relied on. In a saved feed, all 60 municipal seats named by IBGE code fell inside their polygons.
// See docs/DEFESA-CIVIL.md.

/** @typedef {import('./alert-types').AlertPlace} AlertPlace */
/** @typedef {import('./alert-types').AlertAreaName} AlertAreaName */
/** @typedef {import('./alert-types').DefesaCivilAlert} DefesaCivilAlert */
/** @typedef {import('./alert-types').LocationFromWeather} LocationFromWeather */

/** @param {unknown} text */
export const placeKey = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();

/** @type {Record<string, string>} */
const UF_BY_STATE = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE', 'DISTRITO FEDERAL': 'DF',
  'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO', RORAIMA: 'RR', 'SANTA CATARINA': 'SC',
  'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO',
};
const STATE_BY_UF = new Map(Object.entries(UF_BY_STATE).map(([state, uf]) => [uf, state]));

const COVERED_COUNTRIES = new Set(['BRAZIL', 'BRASIL']);
const isCoordinate = (/** @type {unknown} */ value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Reduces a place from a weather reply to what matching needs. Null means the feed cannot cover it.
 * @param {LocationFromWeather | null | undefined} location
 * @returns {AlertPlace | null}
 */
export function alertPlace(location) {
  if (!location || !COVERED_COUNTRIES.has(placeKey(location.country))) return null;
  const { lat, lon } = location;
  return {
    name: placeKey(location.name),
    uf: UF_BY_STATE[placeKey(location.region)] ?? null,
    lat: isCoordinate(lat) ? /** @type {number} */ (lat) : null,
    lon: isCoordinate(lon) ? /** @type {number} */ (lon) : null,
  };
}

/** @param {AlertPlace | null} a @param {AlertPlace | null} b */
export const samePlace = (a, b) => a === b || Boolean(a && b && a.name === b.name && a.uf === b.uf && a.lat === b.lat && a.lon === b.lon);

/**
 * Reads `Itueta/MG, Santa Rita do Itueto/MG`. Anything else in the text is left out.
 * @param {string} text
 * @returns {AlertAreaName[]}
 */
export function parseAreaNames(text) {
  /** @type {AlertAreaName[]} */
  const names = [];
  for (const part of text.split(',')) {
    const slash = part.lastIndexOf('/');
    const uf = part.slice(slash + 1).trim();
    const name = placeKey(part.slice(0, Math.max(slash, 0)));
    if (name && STATE_BY_UF.has(uf)) names.push({ name, uf });
  }
  return names;
}

/** A closed ring of coordinates, packed so that a large municipality costs little memory. */
export class Polygon {
  /** @param {Float32Array} coords lat, lon, lat, lon... @param {number[]} box minLat, maxLat, minLon, maxLon */
  constructor(coords, box) {
    this.coords = coords;
    this.box = box;
  }

  /** @param {number} lat @param {number} lon */
  contains(lat, lon) {
    const { coords, box } = this;
    if (lat < box[0] || lat > box[1] || lon < box[2] || lon > box[3]) return false;
    let inside = false;
    for (let i = 0, j = coords.length - 2; i < coords.length; j = i, i += 2) {
      const latA = coords[i];
      const lonA = coords[i + 1];
      const latB = coords[j];
      const lonB = coords[j + 1];
      if (latA > lat !== latB > lat && lon < ((lonB - lonA) * (lat - latA)) / (latB - latA) + lonA) inside = !inside;
    }
    return inside;
  }
}

const MIN_VERTICES = 3;

/** Takes CAP's `lat,lon lat,lon` in pieces, so a long polygon never has to sit in memory as text. */
export class PolygonBuilder {
  #coords = new Float32Array(256);
  #length = 0;
  #valid = true;
  #box = [Infinity, -Infinity, Infinity, -Infinity];

  /** @param {string} text whole pairs only */
  add(text) {
    for (const pair of text.split(/\s+/)) {
      if (!pair) continue;
      const comma = pair.indexOf(',');
      const lat = comma > 0 ? Number(pair.slice(0, comma)) : NaN;
      const lon = comma > 0 ? Number(pair.slice(comma + 1)) : NaN;
      // A polygon with one bad vertex has an unknown shape, so it must not decide anything.
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
        this.#valid = false;
        return;
      }
      this.#push(lat, lon);
    }
  }

  /** @param {number} lat @param {number} lon */
  #push(lat, lon) {
    if (this.#length === this.#coords.length) {
      const grown = new Float32Array(this.#coords.length * 2);
      grown.set(this.#coords);
      this.#coords = grown;
    }
    this.#coords[this.#length] = lat;
    this.#coords[this.#length + 1] = lon;
    this.#length += 2;
    const box = this.#box;
    if (lat < box[0]) box[0] = lat;
    if (lat > box[1]) box[1] = lat;
    if (lon < box[2]) box[2] = lon;
    if (lon > box[3]) box[3] = lon;
  }

  /** @returns {Polygon | null} */
  build() {
    if (!this.#valid || this.#length < MIN_VERTICES * 2) return null;
    return new Polygon(this.#coords.slice(0, this.#length), this.#box);
  }
}

/**
 * Geometry decides whenever it can. Names are only for an alert with no polygon, and always need the
 * state too: "Santa Teresa/ES" is not Santa Teresa in Rio de Janeiro. "SÃO PAULO/SP" names the state,
 * and in the feed such entries cover only the area of their polygons, not the whole state.
 * @param {DefesaCivilAlert} alert
 * @param {AlertPlace} place
 */
export function affectsPlace(alert, place) {
  const { lat, lon } = place;
  if (alert.polygons.length && lat !== null && lon !== null) return alert.polygons.some((polygon) => polygon.contains(lat, lon));
  return alert.areaNames.some(({ name, uf }) => uf === place.uf && (name === place.name || name === STATE_BY_UF.get(uf)));
}
