import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Polygon, PolygonBuilder, affectsPlace, alertPlace, parseAreaNames, placeKey, samePlace } from '../com.ulanzi.climapro.ulanziPlugin/plugin/alert-area.js';
import { CapFeedReader } from '../com.ulanzi.climapro.ulanziPlugin/plugin/cap-feed.js';
import { square } from './support/cap-builder.mjs';

const brazil = (name, region, lat, lon) => alertPlace({ name, region, country: 'Brazil', lat, lon });
const polygon = (text) => {
  const builder = new PolygonBuilder();
  builder.add(text);
  return builder.build();
};
const alert = (fields) => ({ polygons: [], areaNames: [], ...fields });

function realAlert(id) {
  const reader = new CapFeedReader(Date.parse('2026-10-31T18:30:00-03:00'));
  reader.push(readFileSync(new URL('./fixtures/idap-feed.xml', import.meta.url), 'utf8'));
  return reader.finish().alerts.find((item) => item.id === id);
}

test('a place outside Brazil gets no alert context, so it never triggers a download', () => {
  assert.equal(alertPlace({ name: 'Lisbon', region: 'Lisboa', country: 'Portugal', lat: 38.7, lon: -9.1 }), null);
  assert.equal(alertPlace(null), null);
  assert.notEqual(alertPlace({ name: 'X', region: 'Bahia', country: 'Brasil' }), null);
});

test('names fold accents and case, because WeatherAPI.com and the feed write them differently', () => {
  assert.equal(placeKey('São  Paulo'), placeKey('SAO PAULO'));
  assert.equal(brazil('Florianopolis', 'Santa Catarina', -27.6, -48.5).uf, 'SC');
  assert.equal(brazil('Vitoria', 'Espírito Santo', -20.3, -40.3).uf, 'ES');
  assert.equal(brazil('X', 'Not a state', 0, 0).uf, null);
});

test('coordinates that did not arrive stay unknown, and do not become zero', () => {
  const place = alertPlace({ name: 'X', region: 'Bahia', country: 'Brazil', lat: null });
  assert.equal(place.lat, null);
  assert.equal(place.lon, null);
});

test('the same place is recognized, so an unchanged reply does nothing', () => {
  const a = brazil('Blumenau', 'Santa Catarina', -26.92, -49.07);
  assert.ok(samePlace(a, brazil('Blumenau', 'Santa Catarina', -26.92, -49.07)));
  assert.ok(!samePlace(a, brazil('Blumenau', 'Santa Catarina', -26.92, -49.1)));
  assert.ok(!samePlace(a, null));
  assert.ok(samePlace(null, null));
});

test('area names are read as the feed writes them', () => {
  assert.deepEqual(parseAreaNames('Itueta/MG, Santa Rita do Itueto/MG'), [{ name: 'ITUETA', uf: 'MG' }, { name: 'SANTA RITA DO ITUETO', uf: 'MG' }]);
  assert.deepEqual(parseAreaNames('MINAS GERAIS/MG'), [{ name: 'MINAS GERAIS', uf: 'MG' }]);
  assert.deepEqual(parseAreaNames('Sem estado, Nome/XX, /SC, '), []);
});

test('a polygon contains what is inside it and not what is outside', () => {
  const ring = polygon(square(-26.9, -49, 0.5));
  assert.ok(ring instanceof Polygon);
  assert.ok(ring.contains(-26.9, -49));
  assert.ok(!ring.contains(-26.9, -48.4));
  assert.ok(!ring.contains(-25, -49));
});

test('a concave shape is not treated as its bounding box', () => {
  // A C shape: the notch is inside the box but outside the polygon.
  const shape = polygon('0,0 0,10 3,10 3,3 7,3 7,10 10,10 10,0 0,0');
  assert.ok(shape.contains(1, 5));
  assert.ok(!shape.contains(5, 8));
});

test('real polygon: Ivolândia contains its own seat and not a town 45 km away', () => {
  const ivolandia = realAlert('195709/2026');
  assert.ok(affectsPlace(ivolandia, brazil('Ivolandia', 'Goias', -16.5995, -50.7921)));
  assert.ok(!affectsPlace(ivolandia, brazil('Iporá', 'Goias', -16.4398, -51.1173)));
});

test('real polygon: a state-labelled alert reaches only its drawn area, not the whole state', () => {
  const part = realAlert('195735/2026');
  assert.equal(part.areaDescription, 'SÃO PAULO/SP');
  assert.ok(!affectsPlace(part, brazil('Sao Paulo', 'Sao Paulo', -23.53, -46.62)));
  assert.ok(!affectsPlace(part, brazil('Campinas', 'Sao Paulo', -22.9, -47.06)));
});

test('geometry decides when there is any, even if the name would match', () => {
  const inside = brazil('Blumenau', 'Santa Catarina', -26.92, -49.07);
  const hit = alert({ polygons: [polygon(square(-26.92, -49.07))], areaNames: [{ name: 'BLUMENAU', uf: 'SC' }] });
  const miss = alert({ polygons: [polygon(square(-10, -40))], areaNames: [{ name: 'BLUMENAU', uf: 'SC' }] });
  assert.ok(affectsPlace(hit, inside));
  assert.ok(!affectsPlace(miss, inside));
});

test('a town with the same name in another state is not affected, with or without a polygon', () => {
  const rs = brazil('Bom Jesus', 'Rio Grande do Sul', -28.67, -50.43);
  const pi = brazil('Bom Jesus', 'Piaui', -9.07, -44.36);
  const named = alert({ areaNames: [{ name: 'BOM JESUS', uf: 'RS' }] });
  assert.ok(affectsPlace(named, rs));
  assert.ok(!affectsPlace(named, pi));
  const drawn = alert({ polygons: [polygon(square(-28.67, -50.43))], areaNames: [{ name: 'BOM JESUS', uf: 'RS' }] });
  assert.ok(affectsPlace(drawn, rs));
  assert.ok(!affectsPlace(drawn, pi));
});

test('with no polygon, a state-wide alert reaches the whole state and only that state', () => {
  const stateWide = alert({ areaNames: [{ name: 'SANTA CATARINA', uf: 'SC' }] });
  assert.ok(affectsPlace(stateWide, brazil('Blumenau', 'Santa Catarina', -26.92, -49.07)));
  assert.ok(!affectsPlace(stateWide, brazil('Curitiba', 'Parana', -25.4, -49.3)));
});

test('with no coordinates, the polygon cannot decide, so names do', () => {
  const place = alertPlace({ name: 'Blumenau', region: 'Santa Catarina', country: 'Brazil' });
  assert.ok(affectsPlace(alert({ polygons: [polygon(square(-10, -40))], areaNames: [{ name: 'BLUMENAU', uf: 'SC' }] }), place));
});

test('an unknown state never matches by name, not even an empty one', () => {
  const place = alertPlace({ name: 'Blumenau', region: '', country: 'Brazil' });
  assert.ok(!affectsPlace(alert({ areaNames: [{ name: 'BLUMENAU', uf: 'SC' }] }), place));
});
