// eras.js — the three ages the game is played in.
//
// The Atlantic does not move. Lisbon, Bristol, Antwerp, Recife and Elmina are
// still there in 1880 and still there in 1985, and that continuity is the point
// of the game: you play the same map three times and it behaves like a
// different world each time, because what moves across it has changed.
//
//   Sail  1620 — the wind is the engine. Cargo is measured in tuns, passages in
//                weeks, and the risk is the weather.
//   Steam 1880 — coal is the engine, and coal is also cargo. Passages halve,
//                but you now have to buy your own propulsion at both ends and
//                the bunkers eat the hold.
//   Box   1985 — the box is the unit and the schedule is the product. Voyages
//                are fast and cheap per tonne; the money is in utilisation, and
//                being late costs more than being slow.
//
// Everything here is data. The economy engine reads it and does not care which
// era it is running.

/* =============================== THE ERAS =============================== */

export const ERAS = [
  {
    id: "sail",
    name: "The Age of Sail",
    year: 1620,
    startYear: 1620,
    tagline: "The wind is your engine, and it does not take instruction.",
    blurb: "One tired caravel out of Lisbon, a small line of credit, and the whole " +
           "Atlantic to trade. You cannot sail into the wind, you cannot stop quickly, " +
           "and the market moves on what each port actually holds.",
    unit: "tuns",
    startCash: 1400,
    // Propulsion: the helm reads this to decide whether wind or a throttle drives her.
    propulsion: "wind",
    // Voyages are slow, so a day of wages is small and a day of interest matters.
    wagePerCrewDay: 0.55,
    interestPerDay: 0.0016,
    speedFactor: 0.62,        // fraction of hull speed actually made good
    turnaroundDays: 1,
    hazardScale: 1.0,
    milestones: [5000, 9000, 20000, 45000, 100000],
    money: "£",
  },
  {
    id: "steam",
    name: "The Age of Steam",
    year: 1880,
    startYear: 1880,
    tagline: "You buy your own propulsion now, and it eats the hold.",
    blurb: "A tramp steamer and a mortgage. Coal halves your passages and frees you " +
           "from the wind, but bunkers take hold space, cost money at both ends, and " +
           "run out mid-ocean if you have read the range wrong.",
    unit: "tons",
    startCash: 9000,
    propulsion: "steam",
    wagePerCrewDay: 1.15,
    interestPerDay: 0.00085,
    speedFactor: 0.86,        // a steamer holds her speed in most weather
    turnaroundDays: 2,        // coaling and cargo handling take longer than a sail turnaround
    hazardScale: 0.62,
    milestones: [30000, 80000, 200000, 500000, 1200000],
    money: "£",
    // Bunkers: tons of coal burned per day at full power, as a fraction of hold.
    fuelGood: "coal",
    fuelBurnPerDay: 0.020,    // of hold capacity, per day at sea
  },
  {
    id: "box",
    name: "The Age of the Box",
    year: 1985,
    startYear: 1985,
    tagline: "The schedule is the product. Being late costs more than being slow.",
    blurb: "A feeder ship and a berth window. Cargo is boxes and boxes are all the " +
           "same, so nobody pays you for care — they pay you for turning up when you " +
           "said you would, at a price per box that only works if the ship is full.",
    unit: "TEU",
    startCash: 260000,
    propulsion: "diesel",
    wagePerCrewDay: 4.2,
    interestPerDay: 0.00042,
    speedFactor: 0.94,
    turnaroundDays: 1,
    hazardScale: 0.30,
    milestones: [700000, 1800000, 4500000, 12000000, 30000000],
    money: "$",
    fuelGood: "bunker",
    fuelBurnPerDay: 0.011,
  },
];

export const ERA = Object.fromEntries(ERAS.map((e) => [e.id, e]));

/* ============================== COMMODITIES ==============================
 * `eras` lists which ages a good is traded in. Base prices are in that era's
 * own money, so they are not comparable across eras and do not need to be.
 */

export const ERA_GOODS = {
  sail: [
    "salt", "timber", "cork", "cod", "olive_oil", "port_wine", "sugar",
    "ironwork", "cloth", "tobacco", "coffee", "tea", "spices", "ivory", "gold",
  ],
  steam: [
    "coal", "iron_ore", "pig_iron", "cotton", "wheat", "guano", "timber", "salt",
    "machinery", "cloth", "sugar", "coffee", "tea", "rubber", "palm_oil", "wool",
  ],
  box: [
    "bunker", "electronics", "apparel", "machinery_b", "chemicals", "autos",
    "reefer", "grain", "paper", "furniture", "steel_coil", "pharma", "empties",
  ],
};

/** Goods that exist only in the later ages. Sail's own list lives in world.js. */
export const LATER_GOODS = [
  /* ------------------------------- steam ------------------------------- */
  { id: "coal",       name: "Steam Coal",     base: 14,  bulk: 1,    vol: 0.40, perish: 0,     tier: 0, era: "steam",
    note: "Welsh best. Your cargo and your engine both want it." },
  { id: "iron_ore",   name: "Iron Ore",       base: 11,  bulk: 1.6,  vol: 0.38, perish: 0,     tier: 0, era: "steam",
    note: "Heavy, cheap, and it fills a hold faster than it fills a ledger." },
  { id: "pig_iron",   name: "Pig Iron",       base: 34,  bulk: 1.2,  vol: 0.42, perish: 0,     tier: 0, era: "steam",
    note: "Smelted and cast. Worth carrying where ore is not." },
  { id: "cotton",     name: "Raw Cotton",     base: 62,  bulk: 1.5,  vol: 0.72, perish: 0.001, tier: 0, era: "steam",
    note: "Bulky for its price, and the Lancashire mills never stop asking." },
  { id: "wheat",      name: "Wheat",          base: 26,  bulk: 1.1,  vol: 0.62, perish: 0.002, tier: 0, era: "steam",
    note: "The grain trade. Vast volumes, thin margins, brutal seasonality." },
  { id: "guano",      name: "Guano",          base: 48,  bulk: 1.3,  vol: 0.85, perish: 0,     tier: 1, era: "steam",
    note: "Fertiliser, and a fortune while the deposits last." },
  { id: "machinery",  name: "Machinery",      base: 155, bulk: 1.4,  vol: 0.48, perish: 0,     tier: 1, era: "steam",
    note: "Boilers, looms, rails. The empire's actual export." },
  { id: "rubber",     name: "Rubber",         base: 190, bulk: 1,    vol: 0.95, perish: 0.001, tier: 1, era: "steam",
    note: "Amazon latex. The price is a rumour with a ship attached." },
  { id: "palm_oil",   name: "Palm Oil",       base: 72,  bulk: 1,    vol: 0.66, perish: 0.001, tier: 1, era: "steam",
    note: "West African. Soap, candles, and machine lubricant." },
  { id: "wool",       name: "Wool",           base: 88,  bulk: 1.7,  vol: 0.58, perish: 0,     tier: 0, era: "steam",
    note: "Light and enormous. You run out of space long before tonnage." },

  /* -------------------------------- box -------------------------------- */
  { id: "bunker",      name: "Bunker Fuel",    base: 180,  bulk: 1,   vol: 0.35, perish: 0,     tier: 0, era: "box",
    note: "Heavy fuel oil. Not cargo — this is what the main engine drinks." },
  { id: "electronics", name: "Electronics",    base: 4200, bulk: 1,   vol: 0.80, perish: 0,     tier: 0, era: "box",
    note: "High value per box. Everyone wants the slot." },
  { id: "apparel",     name: "Apparel",        base: 1750, bulk: 1,   vol: 0.62, perish: 0,     tier: 0, era: "box",
    note: "Light, seasonal, and it must land before the season does." },
  { id: "machinery_b", name: "Machine Parts",  base: 2900, bulk: 1,   vol: 0.44, perish: 0,     tier: 0, era: "box",
    note: "Steady industrial flow. Dull, dependable, always moving." },
  { id: "chemicals",   name: "Chemicals",      base: 2300, bulk: 1,   vol: 0.58, perish: 0,     tier: 1, era: "box",
    note: "Tank containers. Handling rules, and a premium for taking them." },
  { id: "autos",       name: "Vehicles",       base: 5600, bulk: 2,   vol: 0.55, perish: 0,     tier: 1, era: "box",
    note: "Two slots each. Worth it where the plants are not." },
  { id: "reefer",      name: "Reefer Cargo",   base: 3100, bulk: 1,   vol: 0.90, perish: 0.010, tier: 1, era: "box",
    note: "Refrigerated. Plugs in, spoils fast, pays well." },
  { id: "grain",       name: "Grain",          base: 900,  bulk: 1.3, vol: 0.60, perish: 0.001, tier: 0, era: "box",
    note: "Bulk in boxes. Low rate, high volume, fills a light ship." },
  { id: "paper",       name: "Paper & Pulp",   base: 1250, bulk: 1.4, vol: 0.42, perish: 0,     tier: 0, era: "box",
    note: "Nordic pulp southbound. Heavy and unglamorous." },
  { id: "furniture",   name: "Furniture",      base: 1400, bulk: 1.8, vol: 0.52, perish: 0,     tier: 0, era: "box",
    note: "All volume, no weight. It cubes out before it weighs out." },
  { id: "steel_coil",  name: "Steel Coil",     base: 1900, bulk: 1.1, vol: 0.50, perish: 0,     tier: 0, era: "box",
    note: "Dense enough to weigh a ship down on half her slots." },
  { id: "pharma",      name: "Pharmaceuticals", base: 8800, bulk: 1,  vol: 0.75, perish: 0.004, tier: 2, era: "box",
    note: "Temperature-controlled and audited. The best rate afloat." },
  { id: "empties",     name: "Empty Boxes",    base: 120,  bulk: 1,   vol: 0.25, perish: 0,     tier: 0, era: "box",
    note: "Repositioning. You lose money on it and you do it anyway." },
];

/* ============================ PORT INDUSTRIES ============================
 * Per-era production and consumption, in units per day. Only the ports that
 * matter in a given age carry an entry; the rest fall back to a light general
 * cargo profile so nowhere is completely dead.
 */

export const ERA_PORTS = {
  steam: {
    bristol:    { produces: { coal: 30, machinery: 20, pig_iron: 18, cloth: 22 },
                  consumes: { cotton: 26, wheat: 22, sugar: 16, rubber: 8, wool: 14, timber: 14, palm_oil: 10, guano: 12 } },
    antwerp:    { produces: { machinery: 26, cloth: 20, pig_iron: 16, tea: 14 },
                  consumes: { coal: 24, wheat: 24, cotton: 18, rubber: 10, coffee: 12, palm_oil: 12, wool: 12, guano: 14 } },
    marseille:  { produces: { machinery: 14, wheat: 12, tea: 8 },
                  consumes: { coal: 22, palm_oil: 14, cotton: 12, rubber: 8, timber: 12, guano: 8 } },
    lisbon:     { produces: { salt: 22, cork: 14, wool: 12 },
                  consumes: { coal: 24, machinery: 16, wheat: 16, iron_ore: 10, cotton: 10 } },
    porto:      { produces: { cork: 16, salt: 12 },
                  consumes: { coal: 18, machinery: 12, wheat: 14, cotton: 10 } },
    cadiz:      { produces: { salt: 20, iron_ore: 22, wheat: 12 },
                  consumes: { coal: 20, machinery: 14, cloth: 12, timber: 12 } },
    tangier:    { produces: { iron_ore: 14, wool: 10 },
                  consumes: { coal: 16, machinery: 10, cloth: 12, wheat: 12 } },
    funchal:    { produces: { sugar: 16 },
                  consumes: { coal: 14, machinery: 8, wheat: 12, cloth: 10, timber: 10, tea: 5 } },
    azores:     { produces: { timber: 12, wool: 8 },
                  consumes: { coal: 18, machinery: 8, wheat: 12, cloth: 10, tea: 6 } },
    canaries:   { produces: { sugar: 12 },
                  consumes: { coal: 16, machinery: 8, wheat: 12, cloth: 10 } },
    cabo_verde: { produces: { salt: 24, guano: 18 },
                  consumes: { coal: 20, wheat: 12, cloth: 10, machinery: 8, timber: 10 } },
    elmina:     { produces: { palm_oil: 26, rubber: 10 },
                  consumes: { cloth: 20, machinery: 16, coal: 14, salt: 10, timber: 10 } },
    sao_tome:   { produces: { palm_oil: 20, sugar: 16 },
                  consumes: { cloth: 14, machinery: 12, coal: 12, wheat: 12, salt: 8 } },
    recife:     { produces: { sugar: 26, cotton: 24, rubber: 14, timber: 16 },
                  consumes: { coal: 22, machinery: 20, cloth: 18, wheat: 16, pig_iron: 12 } },
    salvador:   { produces: { sugar: 22, rubber: 18, coffee: 22, timber: 14 },
                  consumes: { coal: 24, machinery: 22, cloth: 18, wheat: 18, pig_iron: 14 } },
  },
  box: {
    antwerp:    { produces: { machinery_b: 30, chemicals: 26, autos: 20, pharma: 12, paper: 16, bunker: 40, electronics: 22 },
                  consumes: { apparel: 26, grain: 20, furniture: 18, reefer: 16, empties: 20, paper: 10 } },
    bristol:    { produces: { machinery_b: 20, pharma: 14, chemicals: 14, bunker: 26 },
                  consumes: { apparel: 24, electronics: 22, furniture: 18, grain: 16, autos: 12, empties: 16, paper: 14 } },
    marseille:  { produces: { chemicals: 22, autos: 16, steel_coil: 14 },
                  consumes: { apparel: 22, electronics: 20, grain: 18, reefer: 14, empties: 16 } },
    lisbon:     { produces: { apparel: 22, paper: 16, reefer: 14, bunker: 30 },
                  consumes: { electronics: 20, machinery_b: 18, autos: 14, chemicals: 12, grain: 14 } },
    porto:      { produces: { apparel: 26, furniture: 20, paper: 12 },
                  consumes: { electronics: 18, machinery_b: 16, chemicals: 12, grain: 12, steel_coil: 10 } },
    cadiz:      { produces: { reefer: 24, steel_coil: 16 },
                  consumes: { electronics: 18, machinery_b: 16, apparel: 14, autos: 12, empties: 14 } },
    tangier:    { produces: { apparel: 28, empties: 24, bunker: 46, electronics: 20 },
                  consumes: { machinery_b: 16, grain: 14, chemicals: 10, autos: 10, paper: 12 } },
    canaries:   { produces: { reefer: 18, empties: 14, bunker: 34 },
                  consumes: { electronics: 14, machinery_b: 12, grain: 14, apparel: 12, autos: 8, paper: 8 } },
    funchal:    { produces: { reefer: 12 },
                  consumes: { electronics: 12, grain: 12, machinery_b: 10, apparel: 10, autos: 8 } },
    azores:     { produces: { empties: 16 },
                  consumes: { electronics: 12, grain: 14, machinery_b: 10, apparel: 10, reefer: 8 } },
    cabo_verde: { produces: { empties: 20, reefer: 10, bunker: 28 },
                  consumes: { grain: 16, electronics: 12, machinery_b: 12, apparel: 12, paper: 8 } },
    elmina:     { produces: { reefer: 20, empties: 18 },
                  consumes: { machinery_b: 20, electronics: 18, apparel: 14, grain: 18, chemicals: 12 } },
    sao_tome:   { produces: { reefer: 16, empties: 14 },
                  consumes: { machinery_b: 14, electronics: 12, grain: 16, apparel: 12 } },
    recife:     { produces: { reefer: 26, grain: 24, paper: 16, steel_coil: 14 },
                  consumes: { electronics: 24, machinery_b: 22, autos: 18, chemicals: 16, apparel: 14 } },
    salvador:   { produces: { grain: 28, reefer: 22, steel_coil: 18, paper: 14 },
                  consumes: { electronics: 26, machinery_b: 24, autos: 20, chemicals: 18, pharma: 10 } },
  },
};

/* ================================ SHIPS ================================ */

export const ERA_SHIPS = {
  steam: [
    { id: "coaster", name: "Coastal Steamer", hold: 420, speedKn: 8.5, crew: 18, price: 0, rig: "Single screw", masts: 2, seaworthy: 0.86, era: "steam",
      note: "Small, cheap to bunker, and she will not cross an ocean comfortably." },
    { id: "tramp", name: "Tramp Steamer", hold: 1500, speedKn: 9.5, crew: 28, price: 34000, rig: "Triple expansion", masts: 2, seaworthy: 0.90, era: "steam",
      note: "No route, no schedule, no loyalty. Wherever the cargo is." },
    { id: "collier", name: "Collier", hold: 2600, speedKn: 8.8, crew: 30, price: 62000, rig: "Triple expansion", masts: 2, seaworthy: 0.91, era: "steam",
      note: "Built for one thing. Enormous holds, self-trimming, filthy." },
    { id: "liner", name: "Cargo Liner", hold: 3400, speedKn: 13.5, crew: 46, price: 148000, rig: "Twin screw", masts: 3, seaworthy: 0.96, era: "steam",
      note: "Fast, scheduled and expensive. She earns on the clock." },
  ],
  box: [
    { id: "feeder", name: "Feeder", hold: 700, speedKn: 16, crew: 14, price: 0, rig: "Geared", masts: 1, seaworthy: 0.94, era: "box",
      note: "700 TEU with her own cranes, so she can work a port that has none." },
    { id: "handy", name: "Handysize Box", hold: 1800, speedKn: 18.5, crew: 18, price: 900000, rig: "Geared", masts: 1, seaworthy: 0.95, era: "box",
      note: "The workhorse. Fits everywhere, earns everywhere." },
    { id: "panamax", name: "Panamax", hold: 4200, speedKn: 21, crew: 22, price: 2600000, rig: "Gearless", masts: 1, seaworthy: 0.97, era: "box",
      note: "Built to the lock. Cheap per box if you can keep her full." },
    { id: "postpanamax", name: "Post-Panamax", hold: 8500, speedKn: 23, crew: 26, price: 7400000, rig: "Gearless", masts: 1, seaworthy: 0.98, era: "box",
      note: "Too wide for the canal and too big for most berths. Ruinous half-empty." },
  ],
};

export const ERA_UPGRADES = {
  steam: [
    { id: "compound", name: "Compound engine", price: 9000, note: "Re-engine her. +12% speed, and she burns a fifth less coal.",
      apply: (s) => { s.speedKn *= 1.12; s.fuelFactor = (s.fuelFactor ?? 1) * 0.80; } },
    { id: "bunkers", name: "Extra bunkers", price: 6200, note: "More coal, less cargo. +60% range, −10% hold.",
      apply: (s) => { s.hold = Math.round(s.hold * 0.90); s.rangeFactor = (s.rangeFactor ?? 1) * 1.6; } },
    { id: "derricks", name: "Steam derricks", price: 7400, note: "Work your own cargo. A day off every turnaround.",
      apply: (s) => { s.fastTurn = true; } },
    { id: "steelhull", name: "Steel hull plating", price: 12500, note: "Replaces iron. Safer, and she keeps her speed.",
      apply: (s) => { s.seaworthy = Math.min(0.985, s.seaworthy + 0.06); s.wearRate *= 0.55; } },
  ],
  box: [
    { id: "bulbous", name: "Bulbous bow", price: 420000, note: "Retrofit. −14% fuel at service speed.",
      apply: (s) => { s.fuelFactor = (s.fuelFactor ?? 1) * 0.86; } },
    { id: "reeferplugs", name: "Reefer plugs", price: 310000, note: "300 more reefer points. Reefer cargo pays a premium.",
      apply: (s) => { s.reefer = true; } },
    { id: "cranes", name: "Deck cranes", price: 560000, note: "Work ports with no gantry, and turn a day faster.",
      apply: (s) => { s.fastTurn = true; s.hold = Math.round(s.hold * 0.96); } },
    { id: "derate", name: "Engine de-rating", price: 180000, note: "Slow steaming. −12% speed, −34% fuel.",
      apply: (s) => { s.speedKn *= 0.88; s.fuelFactor = (s.fuelFactor ?? 1) * 0.66; } },
  ],
};

/* Ship names, so a new hull is not called "Panamax". */
export const ERA_NAMES = {
  sail: ["Andorinha", "Bom Jesus", "Santa Clara", "Esperança", "São Rafael", "Boa Ventura"],
  steam: ["SS Mersey", "SS Corunna", "SS Ardent", "SS Talisman", "SS Kestrel", "SS Ravenscraig"],
  box: ["MV Meridian", "MV Atlantic Trader", "MV Cape Verde", "MV Iberia Star", "MV Tagus", "MV Bight"],
};
