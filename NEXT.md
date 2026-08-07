# Tradewinds — what's next

Written 6 Aug 2026 at the end of a long session. Everything below is honest
about what is actually done and what is a reskin pretending to be a feature.

## The state of it

**Live:** https://mw572.github.io/things/tradewinds/ (also an artifact URL for
phone use). Verified with the full browser suite run against the live URL.

**Tests:** 240 checks. `node qa/unit.js` (152), `node qa/sim.js` (18 over 96
headless campaigns), `node qa/browser.cjs` (70, needs a server on :8749 and
`NODE_PATH` pointed at `the-apiarist/qa/node_modules`).

**Deploy:** `python3 tools/bundle.py` then copy `dist/tradewinds.html` into the
`things` repo as `tradewinds/index.html`. Pages on the game's own repo has been
unreliable; `things` works.

## What each age now actually has

All six of the surfaces that used to be shared are now per-era:

| Surface | Sail 1620 | Steam 1880 | Box 1985 |
|---|---|---|---|
| Vessel | Caravel: sheer, castles, square rig, lateen mizzen | Tramp: riveted iron, three islands, funnel, derricks | Feeder: flat hull, bulbous bow, stacked boxes, gantry-served |
| Propulsion | Sail polar, no-go zone, in irons | Telegraph with engine-room lag, screw wash on the rudder | Same, plus far more inertia and a lazier turn |
| Berth | Stone mole, bollards, hand crane | Coaling staithes, rail sidings, goods shed | Concrete apron, quay gantries, box yard, straddle carriers |
| Chart | Portolan: parchment, rhumbs, cartouche | Admiralty: soundings, contours, lights, cables | Service network: rotation list, nodes, transit times |
| Language | Exchange, Commissions, Counting house | The Baltic, Fixtures, The office | Rate board, Bookings, Head office |
| Instruments | Point of sail, Canvas | Engine, Revolutions, telegraph | Engine, Power, throttle |

Weather is shared but reads differently: cloud cover, overcast light and rain
are derived from the wind, and a gale is dangerous under canvas, uncomfortable
under steam and a schedule risk for a box ship.

## What is still worth doing

1. **The economy does not yet know about the eras' own pressures.** Steam should
   punish a badly-planned bunker leg much harder, and Box should pay on
   schedule reliability rather than on the spread — being late ought to cost
   more than being slow, which is the tagline and is not yet true in the model.
2. **Moored shipping is still sailing craft in every age.** A coaling berth
   should have steamers alongside and a terminal should have a boxship working.
3. **Port character.** Every harbour is the same generator with a different
   scale; Lisbon and São Tomé should not feel alike.
4. **Sound.** There is none.
5. **The town is still a field of boxes with roofs.** Streets, walls, a quay
   frontage rather than scattered houses.

## Traps found the hard way, do not re-learn these

- **Test the bundle, not just the dev server.** `eras.js` was missing from
  `MODULES` in `tools/bundle.py`; the dev server loads real ES modules and kept
  working while the deployed bundle threw on load. The bundler now fails the
  build on a missing or misordered module, but run `qa/browser.cjs` against the
  deployed URL before claiming anything is live.
- **Port 8642 belongs to the-apiary.** Using it silently tests the wrong game.
  Tradewinds is on 8749.
- **Look at screenshots.** Assertions passed while the sea rendered mirror-flat,
  the wales rendered as a black hula hoop, and the ensign flew along beside the
  ship. None of that is expressible as a cheap assertion; all of it is obvious
  in one frame.
- **Scale is the usual bug.** Waves taller than the freeboard, buildings taller
  than the ship, terrain overlapping the berth, land shelves eating the harbour.
  When something looks wrong, check the numbers against the 26-unit hull first.
- **The harbour's orientation must not depend on the wind.** It did, and on some
  headings the ship spawned inside a hillside.
