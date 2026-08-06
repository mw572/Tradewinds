// world.js — the static world: commodities, ports, geography.
// Pure data + pure functions. No DOM, no Three.js, so the test harness can
// import this straight into node.

/* ============================ COMMODITIES ============================
 * base      — fair price in £ per tun at an average port
 * bulk      — tuns of hold consumed per unit (most goods 1; timber is bulky)
 * vol       — volatility: how hard the price swings on stock imbalance
 * perish    — fraction of the cargo lost per day at sea (0 = keeps forever)
 * tier      — unlocks with the player's standing; 0 is available from day one
 */
export const GOODS = [
  { id: "salt",     name: "Salt",          base: 8,   bulk: 1,   vol: 0.45, perish: 0,      tier: 0, note: "Preserves everything; everyone needs it." },
  { id: "timber",   name: "Timber",        base: 12,  bulk: 2,   vol: 0.40, perish: 0,      tier: 0, note: "Bulky. Two tuns of hold to the unit." },
  { id: "cork",     name: "Cork",          base: 16,  bulk: 1.5, vol: 0.45, perish: 0,      tier: 0, note: "Light, awkward, and Iberia has all of it." },
  { id: "cod",      name: "Dried Cod",     base: 22,  bulk: 1,   vol: 0.55, perish: 0.004,  tier: 0, note: "Bacalhau. Keeps well, but not forever." },
  { id: "olive_oil",name: "Olive Oil",     base: 30,  bulk: 1,   vol: 0.50, perish: 0.002,  tier: 0, note: "Southern presses; northern kitchens." },
  { id: "port_wine",name: "Port Wine",     base: 42,  bulk: 1,   vol: 0.60, perish: 0,      tier: 0, note: "Improves on the voyage, if it survives it." },
  { id: "sugar",    name: "Sugar",         base: 48,  bulk: 1,   vol: 0.70, perish: 0.001,  tier: 0, note: "Brazil and the islands. Europe cannot get enough." },
  { id: "ironwork", name: "Ironwork",      base: 52,  bulk: 1.5, vol: 0.35, perish: 0,      tier: 0, note: "Tools, nails, fittings. Steady demand, dull margins." },
  { id: "cloth",    name: "Woollen Cloth", base: 58,  bulk: 1,   vol: 0.55, perish: 0,      tier: 0, note: "English looms. Cheap at home, dear everywhere else." },
  { id: "tobacco",  name: "Tobacco",       base: 70,  bulk: 1,   vol: 0.80, perish: 0.001,  tier: 1, note: "New-world habit, old-world money." },
  { id: "coffee",   name: "Coffee",        base: 85,  bulk: 1,   vol: 0.85, perish: 0.002,  tier: 1, note: "The coming thing. Volatile as its drinkers." },
  { id: "tea",      name: "Tea",           base: 96,  bulk: 1,   vol: 0.80, perish: 0.001,  tier: 1, note: "Comes overland to the northern ports." },
  { id: "spices",   name: "Spices",        base: 130, bulk: 0.75,vol: 1.00, perish: 0,      tier: 1, note: "Pepper, clove, cinnamon. The old fortune." },
  { id: "ivory",    name: "Ivory",         base: 240, bulk: 1,   vol: 0.95, perish: 0,      tier: 2, note: "Guinea coast. Heavy money, heavy risk." },
  { id: "gold",     name: "Gold Dust",     base: 520, bulk: 0.5, vol: 0.70, perish: 0,      tier: 2, note: "Elmina. Half a tun to the unit, and worth a ship." },
];

export const GOOD = Object.fromEntries(GOODS.map((g) => [g.id, g]));

/* ================================ PORTS ================================
 * lat/lon    — real positions, so the chart and the sailing legs are honest
 * priceIndex — local cost of living; remote stations are dear across the board
 * produces   — units per day flowing INTO the local stock
 * consumes   — units per day flowing OUT of it
 * tier       — the player's standing needed before the port will deal
 * berth      — harbour character, read by the 3-D harbour builder
 */
export const PORTS = [
  {
    id: "lisbon", name: "Lisbon", country: "Portugal", home: true, tier: 0,
    lat: 38.71, lon: -9.14, priceIndex: 1.0,
    blurb: "Home. The Tagus quays, the counting house, and your line of credit.",
    berth: { scale: 1.35, style: "city", lighthouse: true, moored: 4 },
    produces: { salt: 26, cork: 20, olive_oil: 18, port_wine: 16, cod: 14 },
    consumes: { cloth: 20, ironwork: 16, timber: 18, sugar: 14, spices: 9, tea: 6, coffee: 6, tobacco: 7, gold: 3, ivory: 2 },
  },
  {
    id: "porto", name: "Porto", country: "Portugal", tier: 0,
    lat: 41.15, lon: -8.61, priceIndex: 0.97,
    blurb: "Wine country. Barrels come down the Douro faster than ships can take them.",
    berth: { scale: 1.0, style: "river", lighthouse: false, moored: 3 },
    produces: { port_wine: 34, cork: 18, timber: 14 },
    consumes: { salt: 14, cloth: 14, sugar: 12, ironwork: 12, cod: 10, spices: 6, coffee: 5 },
  },
  {
    id: "cadiz", name: "Cádiz", country: "Spain", tier: 0,
    lat: 36.53, lon: -6.29, priceIndex: 1.0,
    blurb: "Andalusian salt pans and olive groves, and the Indies fleet at anchor.",
    berth: { scale: 1.15, style: "fortress", lighthouse: true, moored: 4 },
    produces: { salt: 30, olive_oil: 24, ironwork: 12 },
    consumes: { cloth: 16, timber: 14, cod: 12, tea: 7, spices: 8, tobacco: 8, coffee: 6 },
  },
  {
    id: "tangier", name: "Tangier", country: "Morocco", tier: 0,
    lat: 35.77, lon: -5.80, priceIndex: 1.05,
    blurb: "The gate of the strait. Everything passes through; little stays.",
    berth: { scale: 0.9, style: "kasbah", lighthouse: false, moored: 2 },
    produces: { olive_oil: 16, salt: 14, ivory: 3 },
    consumes: { cloth: 14, ironwork: 12, timber: 10, sugar: 9, port_wine: 8 },
  },
  {
    id: "funchal", name: "Funchal", country: "Madeira", tier: 0,
    lat: 32.65, lon: -16.91, priceIndex: 1.12,
    blurb: "Madeira. Cane and sweet wine on the terraces; short of everything else.",
    berth: { scale: 0.85, style: "island", lighthouse: true, moored: 2 },
    produces: { sugar: 22, port_wine: 10 },
    consumes: { cloth: 12, salt: 10, ironwork: 10, timber: 12, cod: 9, olive_oil: 8, tea: 4 },
  },
  {
    id: "azores", name: "Ponta Delgada", country: "Azores", tier: 0,
    lat: 37.74, lon: -25.68, priceIndex: 1.22,
    blurb: "Mid-ocean. The fleets water here, and everything from away is dear.",
    berth: { scale: 0.8, style: "island", lighthouse: true, moored: 3 },
    produces: { cod: 20, timber: 8 },
    consumes: { cloth: 12, olive_oil: 11, port_wine: 11, ironwork: 9, spices: 5, sugar: 7, coffee: 4 },
  },
  {
    id: "bristol", name: "Bristol", country: "England", tier: 0,
    lat: 51.45, lon: -2.59, priceIndex: 1.06,
    blurb: "England, hungry for southern goods. The looms here never stop.",
    berth: { scale: 1.2, style: "river", lighthouse: false, moored: 4 },
    produces: { cloth: 34, ironwork: 24, tea: 12, coffee: 10 },
    consumes: { port_wine: 20, olive_oil: 16, sugar: 20, salt: 12, cork: 12, spices: 9, tobacco: 12 },
  },
  {
    id: "antwerp", name: "Antwerp", country: "Flanders", tier: 1,
    lat: 51.22, lon: 4.40, priceIndex: 1.08,
    blurb: "The Scheldt. The richest exchange in the north, and it knows it.",
    berth: { scale: 1.3, style: "city", lighthouse: false, moored: 5 },
    produces: { cloth: 26, ironwork: 26, tea: 14, coffee: 14 },
    consumes: { sugar: 22, port_wine: 18, spices: 14, tobacco: 14, olive_oil: 12, cork: 10, ivory: 4, gold: 4 },
  },
  {
    id: "canaries", name: "Santa Cruz", country: "Canaries", tier: 0,
    lat: 28.47, lon: -16.25, priceIndex: 1.14,
    blurb: "Tenerife. Last watering before the trades take you south and west.",
    berth: { scale: 0.9, style: "island", lighthouse: true, moored: 2 },
    produces: { sugar: 16, port_wine: 12 },
    consumes: { cloth: 11, ironwork: 10, timber: 11, cod: 9, salt: 8 },
  },
  {
    id: "cabo_verde", name: "Praia", country: "Cabo Verde", tier: 1,
    lat: 14.93, lon: -23.51, priceIndex: 1.30,
    blurb: "The dry islands. Salt, and a road to the Guinea coast.",
    berth: { scale: 0.7, style: "island", lighthouse: false, moored: 2 },
    produces: { salt: 30 },
    consumes: { cloth: 12, cod: 10, olive_oil: 9, ironwork: 9, timber: 10, port_wine: 8 },
  },
  {
    id: "elmina", name: "Elmina", country: "Gold Coast", tier: 2,
    lat: 5.08, lon: -1.35, priceIndex: 1.42,
    blurb: "The Guinea coast. Gold dust and ivory, at a price that isn't only money.",
    berth: { scale: 0.85, style: "fortress", lighthouse: false, moored: 2 },
    produces: { gold: 5, ivory: 9 },
    consumes: { cloth: 20, ironwork: 20, salt: 12, port_wine: 10, timber: 8 },
  },
  {
    id: "sao_tome", name: "São Tomé", country: "Gulf of Guinea", tier: 2,
    lat: 0.34, lon: 6.73, priceIndex: 1.40,
    blurb: "An equatorial island of cane and fever. Sugar cheap, ships scarce.",
    berth: { scale: 0.7, style: "island", lighthouse: false, moored: 1 },
    produces: { sugar: 26, timber: 10 },
    consumes: { cloth: 14, ironwork: 14, cod: 10, olive_oil: 9, port_wine: 9, salt: 8 },
  },
  {
    id: "recife", name: "Recife", country: "Brazil", tier: 1,
    lat: -8.05, lon: -34.88, priceIndex: 1.34,
    blurb: "Pernambuco. Sugar mills to the horizon, and a reef you must thread.",
    berth: { scale: 0.95, style: "reef", lighthouse: true, moored: 3 },
    produces: { sugar: 34, timber: 16, tobacco: 12 },
    consumes: { cloth: 18, ironwork: 18, olive_oil: 12, port_wine: 14, salt: 12, cod: 12 },
  },
  {
    id: "salvador", name: "Salvador", country: "Brazil", tier: 2,
    lat: -12.97, lon: -38.51, priceIndex: 1.36,
    blurb: "Bahia. The viceroy's town: tobacco, sugar, and a very deep bay.",
    berth: { scale: 1.1, style: "city", lighthouse: true, moored: 4 },
    produces: { tobacco: 26, sugar: 26, timber: 12 },
    consumes: { cloth: 20, ironwork: 18, port_wine: 16, olive_oil: 13, cod: 13, salt: 11 },
  },
  {
    id: "marseille", name: "Marseille", country: "France", tier: 1,
    lat: 43.30, lon: 5.37, priceIndex: 1.04,
    blurb: "Through the strait and into the Mediterranean. Levantine goods land here.",
    berth: { scale: 1.15, style: "city", lighthouse: true, moored: 4 },
    produces: { olive_oil: 26, spices: 12, cloth: 12 },
    consumes: { cod: 14, sugar: 16, timber: 14, ironwork: 12, tobacco: 10, port_wine: 10 },
  },
];

export const PORT = Object.fromEntries(PORTS.map((p) => [p.id, p]));

/* ================================ SHIPS ================================ */
export const SHIPS = [
  { id: "caravel", name: "Caravel", hold: 40,  speedKn: 7.0,  crew: 12, price: 0,     rig: "Lateen",      masts: 2, seaworthy: 0.72,
    note: "Nimble, weatherly, and small. She points high and carries little." },
  { id: "carrack", name: "Carrack", hold: 110, speedKn: 6.2,  crew: 30, price: 5800,  rig: "Square",      masts: 3, seaworthy: 0.84,
    note: "Round-bellied and slow, but she swallows cargo whole." },
  { id: "fluyt",   name: "Fluyt",   hold: 150, speedKn: 7.4,  crew: 22, price: 11500, rig: "Square",      masts: 3, seaworthy: 0.80,
    note: "Dutch-built and cheap to man. The most profitable hull afloat." },
  { id: "galleon", name: "Galleon", hold: 220, speedKn: 6.8,  crew: 52, price: 24000, rig: "Square",      masts: 4, seaworthy: 0.93,
    note: "Armed, heavy and safe. Nothing on the Atlantic troubles her." },
];
export const SHIP = Object.fromEntries(SHIPS.map((s) => [s.id, s]));

/* Hull, rig and hold upgrades. Each applies once per ship. */
export const UPGRADES = [
  { id: "sheathing", name: "Copper sheathing", price: 1400, note: "Keeps the worm out. +10% speed, halves wear.",
    apply: (s) => { s.speedKn *= 1.10; s.wearRate *= 0.5; } },
  { id: "holdext",   name: "Extended hold",    price: 1900, note: "Cut down the great cabin. +25% hold, −4% speed.",
    apply: (s) => { s.hold = Math.round(s.hold * 1.25); s.speedKn *= 0.96; } },
  { id: "topsails",  name: "Topsails & staysails", price: 2600, note: "More canvas aloft. +14% speed.",
    apply: (s) => { s.speedKn *= 1.14; } },
  { id: "guns",      name: "Ship's guns",      price: 3400, note: "Twelve six-pounders. Privateers look elsewhere.",
    apply: (s) => { s.seaworthy = Math.min(0.98, s.seaworthy + 0.10); s.armed = true; s.speedKn *= 0.97; } },
];
export const UPGRADE = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/* =============================== GEOGRAPHY =============================== */

const R_NM = 3440.065; // earth radius in nautical miles
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two ports, in nautical miles. */
export function distanceNm(fromId, toId) {
  const a = PORT[fromId], b = PORT[toId];
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from one port to another, in degrees. */
export function bearing(fromId, toId) {
  const a = PORT[fromId], b = PORT[toId];
  const la1 = toRad(a.lat), la2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Passage estimate. Real ships never make their best speed for a whole passage:
 * calms, foul winds and reefing cost you. 62% of hull speed is a fair average,
 * and the trade winds give a bonus on the southbound Atlantic runs.
 */
export function passage(fromId, toId, shipSpeedKn) {
  const nm = distanceNm(fromId, toId);
  const a = PORT[fromId], b = PORT[toId];
  // Trade winds: westward and southward passages in the tropics run faster.
  const southing = a.lat - b.lat;
  const westing = a.lon - b.lon;
  const tropical = Math.abs(a.lat) < 35 || Math.abs(b.lat) < 35;
  let windFactor = 1.0;
  if (tropical && southing > 5 && westing > 0) windFactor = 1.18;   // running down the trades
  else if (tropical && southing < -5 && westing < 0) windFactor = 0.88; // beating home against them
  const knots = shipSpeedKn * 0.62 * windFactor;
  // Plus a day warping out, working the tide and clearing the customs house.
  // Without it, short hops like Lisbon to Porto become a grindable loop.
  const days = Math.max(2, Math.round(nm / (knots * 24)) + 1);
  return { nm: Math.round(nm), days, bearing: Math.round((bearing(fromId, toId) + 360) % 360) };
}

/** Chart projection: lon/lat → 0..1 square, for drawing the course plotter. */
export const CHART_BOUNDS = { lonMin: -46, lonMax: 12, latMin: -18, latMax: 56 };
export function chartXY(lat, lon) {
  const { lonMin, lonMax, latMin, latMax } = CHART_BOUNDS;
  return {
    x: (lon - lonMin) / (lonMax - lonMin),
    y: 1 - (lat - latMin) / (latMax - latMin),
  };
}

/** Compass point name for a bearing in degrees. */
const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function cardinal(deg) {
  return CARDINALS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/** Season for a game day. Day 1 is 1 March 1620. */
export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
export function seasonOf(day) {
  return SEASONS[Math.floor((((day - 1) % 360) / 90)) % 4];
}
export function dateOf(day) {
  const MONTHS = ["March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December", "January", "February"];
  const d = (day - 1) % 360;
  const year = 1620 + Math.floor((day - 1) / 360);
  return { day: (d % 30) + 1, month: MONTHS[Math.floor(d / 30)], year };
}
