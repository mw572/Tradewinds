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

## The honest gap

Marcus's words, and he is right: *"steam and box doesn't use different ship and
dynamics, same maps and counting house etc."*

The three ages currently share one shell. What genuinely differs is the data —
goods, ports, hulls, refits, currency, wages, interest, hazard, milestones,
bunkers, passage times. What does **not** differ is everything the player looks
at and touches:

| Surface | Now | Should be |
|---|---|---|
| Chart | 1620 portolan in all three ages | Steam: an Admiralty chart — soundings in fathoms, lighthouse characteristics, cable routes, steamer tracks, coaling stations marked. Box: a schedule/network view — a liner-service loop with berth windows and transit times, not a map you plot courses on |
| Helm | Sails and point-of-sail in all three | Steam: engine-room telegraph, ahead/astern, boiler pressure, steerage way, no wind term. Box: bridge console, bow thruster, pilot aboard, berthing by metres-per-minute closing speed |
| 3-D vessel | The caravel in all three | A steamer (single funnel, counter stern, derricks, no square rig) and a boxship (flat deck, bay/row/tier stacks, deckhouse aft, gantry-served berth) |
| Tab names | "Counting house", "Commissions", "The Exchange" | Steam: "The office", "Fixtures", "The Baltic". Box: "Head office", "Bookings", "The rate board" |
| Harbour | Stone quay, cathedral, moored sailing craft | Steam: coaling staithes, cranes, rail sidings, smoke. Box: container gantries, stacked boxes, straddle carriers, no town at all |
| Money | £/$ symbol swap only | Per-era number formatting and orders of magnitude in the UI |

## The order I would do it in

1. **Era-specific 3-D vessels** (`src/ship3d.js`). Biggest visual payoff. The
   hull loft already takes dimensions, so a steamer is mostly a different
   superstructure, funnel and stern, and a boxship is a flat-decked hull with
   instanced container stacks. `Ship3D` should dispatch on `spec.era`.
2. **Era-specific helm physics** (`src/sailing.js`). `ERA.propulsion` already
   exists and is unused. Wind drives `sailPower` only for `wind`; steam and
   diesel want a throttle, a telegraph lag, and no no-go zone. Docking stays the
   skill in all three, but the failure modes differ.
3. **Era-specific chart** (`src/chart.js`). Split into three renderers over the
   same projection and coastline data. The portolan is written; the Admiralty
   chart and the network diagram are new.
4. **Era-specific harbours** (`src/harbour.js`). Drive furniture off
   `ERA` + `port.berth.style` rather than style alone.
5. **Era-specific UI language** (`index.html`, `src/game.js`). Tab labels,
   panel headings and flavour text from a per-era strings table.
6. **Town density** (task #9, never done). Buildings are sparse and small on the
   headland; needs more of them, varied massing, chimneys, trees, quay clutter.

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
