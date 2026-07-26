/**
 * European rail graph for the Interrail planner.
 *
 * Deliberately a CURATED STATIC GRAPH, not a live timetable feed. To
 * plan an Interrail trip you don't need "the 08:42 on Tuesday" — you
 * need "can I get Ljubljana → Zagreb, roughly how long, and do I need a
 * reservation". Live timetables are a later upgrade that can layer on
 * top of this (see docs in HolidayRail.jsx); the graph stays as the
 * fail-soft floor so the planner always works offline and never depends
 * on an unofficial API staying up.
 *
 * Times are TYPICAL DIRECT journey times in minutes for the fastest
 * regular service, rounded — they are planning estimates, not
 * guarantees, and the UI labels them as such. `r: 1` marks a leg where
 * a compulsory reservation applies on top of an Interrail pass (French
 * and Spanish high-speed, Eurostar, most Italian Frecce, night trains,
 * many international services).
 *
 * Coordinates are the main station, used for map placement.
 */

// id, name, ISO2 country, lat, lon
export const STATIONS = [
  // ── British Isles ──
  { id: 'lon', name: 'London',     c: 'GB', lat: 51.53, lon: -0.13 },
  { id: 'man', name: 'Manchester', c: 'GB', lat: 53.48, lon: -2.24 },
  { id: 'edi', name: 'Edinburgh',  c: 'GB', lat: 55.95, lon: -3.19 },
  { id: 'gla', name: 'Glasgow',    c: 'GB', lat: 55.86, lon: -4.25 },
  { id: 'bel', name: 'Belfast',    c: 'GB', lat: 54.60, lon: -5.93 },
  { id: 'dub', name: 'Dublin',     c: 'IE', lat: 53.35, lon: -6.26 },

  // ── France ──
  { id: 'par', name: 'Paris',       c: 'FR', lat: 48.88, lon: 2.36 },
  { id: 'lil', name: 'Lille',       c: 'FR', lat: 50.63, lon: 3.06 },
  { id: 'str', name: 'Strasbourg',  c: 'FR', lat: 48.58, lon: 7.75 },
  { id: 'dij', name: 'Dijon',       c: 'FR', lat: 47.32, lon: 5.04 },
  { id: 'lyo', name: 'Lyon',        c: 'FR', lat: 45.76, lon: 4.86 },
  { id: 'mrs', name: 'Marseille',   c: 'FR', lat: 43.30, lon: 5.38 },
  { id: 'nic', name: 'Nice',        c: 'FR', lat: 43.70, lon: 7.27 },
  { id: 'mon', name: 'Montpellier', c: 'FR', lat: 43.61, lon: 3.88 },
  { id: 'tls', name: 'Toulouse',    c: 'FR', lat: 43.61, lon: 1.44 },
  { id: 'bdx', name: 'Bordeaux',    c: 'FR', lat: 44.84, lon: -0.58 },
  { id: 'nan', name: 'Nantes',      c: 'FR', lat: 47.22, lon: -1.55 },
  { id: 'ren', name: 'Rennes',      c: 'FR', lat: 48.11, lon: -1.68 },

  // ── Benelux ──
  { id: 'bru', name: 'Brussels',   c: 'BE', lat: 50.86, lon: 4.36 },
  { id: 'ant', name: 'Antwerp',    c: 'BE', lat: 51.22, lon: 4.42 },
  { id: 'ams', name: 'Amsterdam',  c: 'NL', lat: 52.38, lon: 4.90 },
  { id: 'rtm', name: 'Rotterdam',  c: 'NL', lat: 51.92, lon: 4.47 },
  { id: 'utr', name: 'Utrecht',    c: 'NL', lat: 52.09, lon: 5.11 },
  { id: 'lux', name: 'Luxembourg', c: 'LU', lat: 49.60, lon: 6.13 },

  // ── Germany ──
  { id: 'col', name: 'Cologne',   c: 'DE', lat: 50.94, lon: 6.96 },
  { id: 'dus', name: 'Düsseldorf',c: 'DE', lat: 51.22, lon: 6.79 },
  { id: 'fra', name: 'Frankfurt', c: 'DE', lat: 50.11, lon: 8.66 },
  { id: 'stu', name: 'Stuttgart', c: 'DE', lat: 48.78, lon: 9.18 },
  { id: 'mun', name: 'Munich',    c: 'DE', lat: 48.14, lon: 11.56 },
  { id: 'nur', name: 'Nuremberg', c: 'DE', lat: 49.45, lon: 11.08 },
  { id: 'ber', name: 'Berlin',    c: 'DE', lat: 52.53, lon: 13.37 },
  { id: 'ham', name: 'Hamburg',   c: 'DE', lat: 53.55, lon: 10.01 },
  { id: 'han', name: 'Hannover',  c: 'DE', lat: 52.38, lon: 9.74 },
  { id: 'lei', name: 'Leipzig',   c: 'DE', lat: 51.35, lon: 12.38 },
  { id: 'dre', name: 'Dresden',   c: 'DE', lat: 51.04, lon: 13.73 },

  // ── Switzerland & Austria ──
  { id: 'bas', name: 'Basel',      c: 'CH', lat: 47.55, lon: 7.59 },
  { id: 'zur', name: 'Zurich',     c: 'CH', lat: 47.38, lon: 8.54 },
  { id: 'brn', name: 'Bern',       c: 'CH', lat: 46.95, lon: 7.44 },
  { id: 'int', name: 'Interlaken', c: 'CH', lat: 46.69, lon: 7.85 },
  { id: 'gen', name: 'Geneva',     c: 'CH', lat: 46.21, lon: 6.14 },
  { id: 'vie', name: 'Vienna',     c: 'AT', lat: 48.19, lon: 16.38 },
  { id: 'sal', name: 'Salzburg',   c: 'AT', lat: 47.81, lon: 13.05 },
  { id: 'inn', name: 'Innsbruck',  c: 'AT', lat: 47.26, lon: 11.40 },
  { id: 'lnz', name: 'Linz',       c: 'AT', lat: 48.29, lon: 14.29 },
  { id: 'grz', name: 'Graz',       c: 'AT', lat: 47.07, lon: 15.44 },
  { id: 'kla', name: 'Klagenfurt', c: 'AT', lat: 46.62, lon: 14.31 },

  // ── Italy ──
  { id: 'mil', name: 'Milan',    c: 'IT', lat: 45.49, lon: 9.20 },
  { id: 'tur', name: 'Turin',    c: 'IT', lat: 45.07, lon: 7.68 },
  { id: 'gnv', name: 'Genoa',    c: 'IT', lat: 44.41, lon: 8.92 },
  { id: 'ver', name: 'Verona',   c: 'IT', lat: 45.43, lon: 10.98 },
  { id: 'ven', name: 'Venice',   c: 'IT', lat: 45.44, lon: 12.32 },
  { id: 'tri', name: 'Trieste',  c: 'IT', lat: 45.65, lon: 13.77 },
  { id: 'bol', name: 'Bologna',  c: 'IT', lat: 44.51, lon: 11.34 },
  { id: 'flr', name: 'Florence', c: 'IT', lat: 43.78, lon: 11.25 },
  { id: 'rom', name: 'Rome',     c: 'IT', lat: 41.90, lon: 12.50 },
  { id: 'nap', name: 'Naples',   c: 'IT', lat: 40.85, lon: 14.27 },

  // ── Iberia ──
  { id: 'mad', name: 'Madrid',    c: 'ES', lat: 40.41, lon: -3.69 },
  { id: 'bcn', name: 'Barcelona', c: 'ES', lat: 41.38, lon: 2.18 },
  { id: 'zar', name: 'Zaragoza',  c: 'ES', lat: 41.65, lon: -0.89 },
  { id: 'val', name: 'Valencia',  c: 'ES', lat: 39.47, lon: -0.38 },
  { id: 'alc', name: 'Alicante',  c: 'ES', lat: 38.35, lon: -0.48 },
  { id: 'sev', name: 'Seville',   c: 'ES', lat: 37.39, lon: -5.98 },
  { id: 'mal', name: 'Málaga',    c: 'ES', lat: 36.72, lon: -4.42 },
  { id: 'bio', name: 'Bilbao',    c: 'ES', lat: 43.26, lon: -2.93 },
  { id: 'lis', name: 'Lisbon',    c: 'PT', lat: 38.72, lon: -9.14 },
  { id: 'por', name: 'Porto',     c: 'PT', lat: 41.15, lon: -8.61 },

  // ── Central & Eastern Europe ──
  { id: 'pra', name: 'Prague',    c: 'CZ', lat: 50.08, lon: 14.44 },
  { id: 'bno', name: 'Brno',      c: 'CZ', lat: 49.19, lon: 16.61 },
  { id: 'bra', name: 'Bratislava',c: 'SK', lat: 48.16, lon: 17.11 },
  { id: 'kos', name: 'Košice',    c: 'SK', lat: 48.72, lon: 21.26 },
  { id: 'bud', name: 'Budapest',  c: 'HU', lat: 47.50, lon: 19.08 },
  { id: 'kra', name: 'Kraków',    c: 'PL', lat: 50.07, lon: 19.95 },
  { id: 'war', name: 'Warsaw',    c: 'PL', lat: 52.23, lon: 21.00 },
  { id: 'poz', name: 'Poznań',    c: 'PL', lat: 52.40, lon: 16.91 },
  { id: 'wro', name: 'Wrocław',   c: 'PL', lat: 51.11, lon: 17.04 },
  { id: 'gda', name: 'Gdańsk',    c: 'PL', lat: 54.36, lon: 18.64 },

  // ── Balkans ──
  { id: 'lju', name: 'Ljubljana',    c: 'SI', lat: 46.06, lon: 14.51 },
  { id: 'zag', name: 'Zagreb',       c: 'HR', lat: 45.80, lon: 15.98 },
  { id: 'spl', name: 'Split',        c: 'HR', lat: 43.51, lon: 16.44 },
  { id: 'sar', name: 'Sarajevo',     c: 'BA', lat: 43.86, lon: 18.41 },
  { id: 'beo', name: 'Belgrade',     c: 'RS', lat: 44.82, lon: 20.46 },
  { id: 'skp', name: 'Skopje',       c: 'MK', lat: 41.99, lon: 21.43 },
  { id: 'sof', name: 'Sofia',        c: 'BG', lat: 42.70, lon: 23.32 },
  { id: 'buc', name: 'Bucharest',    c: 'RO', lat: 44.45, lon: 26.07 },
  { id: 'clj', name: 'Cluj-Napoca',  c: 'RO', lat: 46.77, lon: 23.60 },
  { id: 'tsa', name: 'Thessaloniki', c: 'GR', lat: 40.64, lon: 22.94 },
  { id: 'ath', name: 'Athens',       c: 'GR', lat: 37.99, lon: 23.72 },
  { id: 'ist', name: 'Istanbul',     c: 'TR', lat: 41.01, lon: 28.98 },

  // ── Nordics & Baltics ──
  { id: 'cph', name: 'Copenhagen', c: 'DK', lat: 55.67, lon: 12.57 },
  { id: 'aar', name: 'Aarhus',     c: 'DK', lat: 56.15, lon: 10.20 },
  { id: 'mlm', name: 'Malmö',      c: 'SE', lat: 55.61, lon: 13.00 },
  { id: 'got', name: 'Gothenburg', c: 'SE', lat: 57.71, lon: 11.97 },
  { id: 'sto', name: 'Stockholm',  c: 'SE', lat: 59.33, lon: 18.07 },
  { id: 'kir', name: 'Kiruna',     c: 'SE', lat: 67.85, lon: 20.23 },
  { id: 'osl', name: 'Oslo',       c: 'NO', lat: 59.91, lon: 10.75 },
  { id: 'brg', name: 'Bergen',     c: 'NO', lat: 60.39, lon: 5.32 },
  { id: 'trd', name: 'Trondheim',  c: 'NO', lat: 63.43, lon: 10.40 },
  { id: 'nrk', name: 'Narvik',     c: 'NO', lat: 68.44, lon: 17.43 },
  { id: 'hel', name: 'Helsinki',   c: 'FI', lat: 60.17, lon: 24.94 },
  { id: 'tam', name: 'Tampere',    c: 'FI', lat: 61.50, lon: 23.79 },
  { id: 'oul', name: 'Oulu',       c: 'FI', lat: 65.01, lon: 25.47 },
  { id: 'rov', name: 'Rovaniemi',  c: 'FI', lat: 66.50, lon: 25.73 },
  { id: 'tll', name: 'Tallinn',    c: 'EE', lat: 59.44, lon: 24.75 },
  { id: 'rig', name: 'Riga',       c: 'LV', lat: 56.95, lon: 24.11 },
  { id: 'vln', name: 'Vilnius',    c: 'LT', lat: 54.69, lon: 25.28 },
];

// [from, to, typical minutes, reservation compulsory?]
export const EDGES = [
  // British Isles + Channel
  ['lon', 'man', 130], ['lon', 'edi', 260], ['man', 'edi', 215],
  ['man', 'gla', 210], ['edi', 'gla', 50], ['dub', 'bel', 130],
  ['lon', 'par', 140, 1], ['lon', 'bru', 120, 1], ['lon', 'lil', 80, 1],

  // France
  ['par', 'lil', 60, 1], ['par', 'str', 105, 1], ['par', 'dij', 95, 1],
  ['par', 'lyo', 115, 1], ['par', 'mrs', 200, 1], ['par', 'bdx', 130, 1],
  ['par', 'nan', 130, 1], ['par', 'ren', 90, 1], ['par', 'tls', 260, 1],
  ['lyo', 'dij', 100, 1], ['lyo', 'mrs', 100, 1], ['lyo', 'gen', 115, 1],
  ['mrs', 'nic', 155, 1], ['mrs', 'mon', 100, 1], ['mon', 'tls', 135, 1],
  ['mon', 'bcn', 175, 1], ['tls', 'bdx', 130, 1], ['bdx', 'bio', 260, 1],
  ['str', 'bas', 85, 1], ['str', 'mun', 220, 1], ['str', 'lux', 130],
  ['nic', 'tur', 300, 1], ['nic', 'ven', 600, 1],

  // Benelux
  ['bru', 'ant', 45], ['ant', 'rtm', 45, 1], ['rtm', 'ams', 40],
  ['ams', 'utr', 30], ['utr', 'col', 160], ['bru', 'lux', 195],
  ['bru', 'par', 85, 1], ['bru', 'col', 110, 1], ['bru', 'lil', 35, 1],
  ['ams', 'ber', 380], ['ams', 'fra', 235, 1], ['dus', 'ams', 130],

  // Germany
  ['col', 'dus', 25], ['col', 'fra', 65], ['fra', 'stu', 80],
  ['fra', 'mun', 200], ['fra', 'ber', 250], ['fra', 'han', 145],
  ['fra', 'bas', 175], ['fra', 'zur', 235, 1], ['stu', 'mun', 135],
  ['mun', 'nur', 65], ['nur', 'ber', 190], ['nur', 'lei', 200],
  ['ber', 'ham', 110], ['ber', 'han', 100], ['ber', 'lei', 75],
  ['ber', 'dre', 130], ['lei', 'dre', 70], ['han', 'ham', 80],
  ['han', 'col', 165], ['ham', 'cph', 275, 1], ['ber', 'pra', 255, 1],
  ['dre', 'pra', 135], ['ber', 'poz', 165, 1], ['ber', 'war', 340, 1],
  ['mun', 'zur', 210, 1], ['mun', 'sal', 90], ['mun', 'inn', 105],
  ['mun', 'vie', 240, 1],

  // Switzerland
  ['bas', 'zur', 55], ['bas', 'brn', 55], ['zur', 'brn', 60],
  ['brn', 'int', 55], ['brn', 'gen', 105], ['zur', 'mil', 200, 1],
  ['gen', 'mil', 240, 1], ['zur', 'inn', 210],

  // Austria
  ['vie', 'sal', 150], ['vie', 'lnz', 75], ['lnz', 'sal', 70],
  ['sal', 'inn', 110], ['vie', 'grz', 155], ['grz', 'kla', 175],
  ['kla', 'lju', 220], ['vie', 'bra', 60], ['vie', 'bud', 160],
  ['vie', 'pra', 240], ['vie', 'ven', 470, 1],

  // Italy
  ['mil', 'tur', 50, 1], ['mil', 'gnv', 95], ['gnv', 'tur', 105],
  ['mil', 'ver', 75, 1], ['ver', 'ven', 70], ['mil', 'ven', 150, 1],
  ['mil', 'bol', 65, 1], ['bol', 'flr', 40, 1], ['bol', 'ven', 90, 1],
  ['flr', 'rom', 95, 1], ['rom', 'nap', 70, 1], ['ven', 'tri', 120],
  ['tri', 'lju', 150],

  // Iberia
  ['mad', 'bcn', 155, 1], ['mad', 'sev', 155, 1], ['mad', 'val', 105, 1],
  ['mad', 'zar', 80, 1], ['zar', 'bcn', 90, 1], ['val', 'alc', 95, 1],
  ['val', 'bcn', 190, 1], ['sev', 'mal', 115, 1], ['mad', 'mal', 165, 1],
  ['mad', 'bio', 300, 1], ['mad', 'lis', 600, 1], ['lis', 'por', 170, 1],

  // Central & Eastern
  ['pra', 'bno', 165], ['bno', 'vie', 95], ['bno', 'bra', 90],
  ['bra', 'bud', 145, 1], ['bra', 'kos', 300], ['kos', 'bud', 300],
  ['bud', 'kra', 420, 1], ['kra', 'war', 150, 1], ['war', 'gda', 175, 1],
  ['war', 'poz', 165, 1], ['poz', 'wro', 150], ['wro', 'kra', 200],
  ['wro', 'pra', 380], ['vln', 'war', 480, 1],

  // Balkans
  ['lju', 'zag', 150], ['zag', 'spl', 360, 1], ['zag', 'bud', 350],
  ['zag', 'sar', 540], ['beo', 'sar', 480], ['bud', 'beo', 480, 1],
  ['beo', 'sof', 480], ['beo', 'skp', 480], ['skp', 'tsa', 240],
  ['sof', 'buc', 540], ['sof', 'ist', 660, 1], ['bud', 'buc', 900, 1],
  ['buc', 'clj', 480], ['clj', 'bud', 420], ['tsa', 'ath', 240, 1],
  ['tsa', 'sof', 420], ['tsa', 'ist', 720],

  // Nordics & Baltics
  ['cph', 'mlm', 35], ['cph', 'aar', 180, 1], ['mlm', 'got', 165, 1],
  ['mlm', 'sto', 270, 1], ['got', 'sto', 210, 1], ['sto', 'osl', 390, 1],
  ['osl', 'brg', 400, 1], ['osl', 'trd', 400, 1], ['trd', 'nrk', 900],
  ['sto', 'kir', 900, 1], ['kir', 'nrk', 180], ['hel', 'tam', 90],
  ['tam', 'oul', 300], ['oul', 'rov', 130], ['hel', 'oul', 390, 1],
  ['tll', 'rig', 380, 1], ['rig', 'vln', 240, 1],
];

export const STATION_BY_ID = Object.fromEntries(STATIONS.map(s => [s.id, s]));

/** Adjacency list: id → [{ to, min, res }]. Built once at module load. */
export const ADJACENCY = (() => {
  const adj = {};
  for (const s of STATIONS) adj[s.id] = [];
  for (const [a, b, min, res] of EDGES) {
    if (!adj[a] || !adj[b]) continue;   // guard against a typo'd id
    adj[a].push({ to: b, min, res: !!res });
    adj[b].push({ to: a, min, res: !!res });
  }
  return adj;
})();
