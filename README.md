# Tradewinds ⚓

A merchant-shipping economy game. You run a small trading house out of Lisbon in
the age of sail: **buy low** at the docks, **plot a course**, **bring your ship
alongside the berth by hand** in 3-D, and **sell dear**. The market moves with
supply, demand — and your own trades.

This is the **Leg 0 vertical slice**: one era (Age of Sail), six Atlantic ports,
one caravel, and the full core loop end to end. It runs entirely in the browser
with **no build step** — plain ES modules and a vendored copy of Three.js — so it
hosts on GitHub Pages as-is.

> Part of a larger design. See the full proposal for the roadmap (economic depth,
> eras, fleet, polish).

## Play

- **At the docks:** trade commodities on The Exchange. Goods tagged *produced here*
  are cheap to buy; goods *wanted here* sell dear. Big trades move the price, so
  don't dump your whole hold in one port. Pick a destination and set sail.
- **At the helm (3-D):**
  - `▲ / ▼` — trim the sail (more / less power)
  - `◀ / ▶` — rudder
  - `SPACE` — make fast (dock), when you're inside the green berth ring, slow, and
    roughly aligned
- **Sailing:** you can't sail straight into the wind. Watch the point-of-sail
  readout — a beam reach is fastest; *in irons* means you've stalled head-to-wind.
  Approach the berth slowly; ships carry their momentum.

Goal: grow your net worth. Reach **£5,000** and you've established the house.

## Run locally

Any static file server works (ES modules need HTTP, not `file://`):

```bash
cd tradewinds
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to GitHub Pages

1. Put these files at the **root** of a repository.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`) publishes
   the static site — no build required.

## Moving this into its own repo

This slice was scaffolded inside a subfolder for safekeeping. To split it into a
dedicated `tradewinds` repo with its history intact:

```bash
git subtree split --prefix=tradewinds -b tradewinds-only
# create an empty 'tradewinds' repo on GitHub, then:
git push git@github.com:mw572/tradewinds.git tradewinds-only:main
```

Or simply copy the `tradewinds/` folder into a fresh repo.

## Layout

```
tradewinds/
├── index.html          # screens: title, docks, helm
├── styles.css          # maritime UI (ship's-console palette)
├── src/
│   ├── economy.js      # ports, goods, market model, player state
│   ├── sailing.js      # Three.js: Gerstner ocean, ship physics, docking
│   └── game.js         # screen flow + wiring
├── vendor/three.module.js
└── .github/workflows/deploy.yml
```

## Tech

Vanilla ES modules + [Three.js](https://threejs.org) (vendored). No framework, no
bundler — deliberately, so the slice stays trivially hostable. A later leg can move
to Vite + React as the UI grows.
