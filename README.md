# Soldier Paths

Look up a Canadian soldier, follow his path through the war on a map and timeline, compare soldiers, and see when their paths came close.

Starts with Clayton Brown (23rd Battery, 2nd Anti-Tank Regiment, 2nd Canadian Infantry Division) and Gordon Sweet (RCAMC, 2nd Canadian Armoured Brigade), then grows through their formations one war diary at a time.

## How it works

- `data/*.csv` is the source of truth. Edit in a spreadsheet or text editor.
- `npm run build` checks the data, works out each soldier's day-by-day track and the close-by moments, and writes JSON to `site/data/`.
- `site/` is a static site that reads that JSON. `npm run serve` builds and serves it locally.
  - `index.html` is the story view: sticky map, to-scale timeline with the exact date, scrolling story with quoted sources, one tab per soldier.
  - `check.html` is a plain data-check view with a date slider.

## Data files

| File | One row per |
| --- | --- |
| `soldiers.csv` | soldier |
| `units.csv` | unit, with its default parent (battery > regiment > division ...) |
| `unit_parents.csv` | dated change of parent (attachments, re-brigading) |
| `postings.csv` | soldier in a unit for a date range |
| `unit_locations.csv` | unit at a place for a date range, from a war diary |
| `events.csv` | dated thing that happened to one soldier (birth, enlistment, wound, location...) |
| `places.csv` | place with coordinates and how precise they are |
| `sources.csv` | document that facts cite |
| `quotes.csv` | exact quote from a source, attached to an event |
| `closeby_notes.csv` | hand-written note about two soldiers being near each other, linked to the stops it describes |
| `conflicts.csv` | place where sources disagree, naming the two facts |
| `landmarks.csv` | battle (◆) or memorial (✚) shown on the map |
| `glossary.csv` | term with a short note, shown as a dotted-underline tooltip |
| `media/face-<soldier_id>.jpg` | portrait used for the map pin |
| `import/` | raw files the CSVs were imported from (`node scripts/import_timeline.mjs`) |

Rules the build enforces:

- Every fact (posting, unit location, event) has a `source_id` that exists in `sources.csv`.
- `confidence` is one of `documented`, `inherited`, `inferred`, `family`.
- `status` is one of `ai_draft`, `checked`, `confirmed`, `disputed`, `family`.
- Dates are written the way records write them: `19 Jun 1944`, `Jun 1944`, `1944`, `Winter 1944`, `Fall 1944`, `1942 to 1944`, `1946 on`, `about 19 Jun 1944`.
- `data/private/` is never read by the build or committed.

## Where a soldier is on a given day

1. His own dated event with a place, until the next one.
2. Otherwise his unit's location from the war diary, walking up the unit tree (battery, regiment, division) with a growing uncertainty radius.

A unit location replaces a personal event once that event's date range has ended.

## Close by

Two soldiers are **likely** within 10 km when distance plus both uncertainty radii is 10 km or less, and **possibly** when the circles allow it. Consecutive days merge into one episode. The written note never says the men met; no source in this pipeline records contact.

## Map

- Zoomed out: an orthographic globe drawn with d3 on canvas (Natural Earth outlines from `world-atlas`).
- Zoomed in (view narrower than about 300 km): a detailed tiled map fades in underneath, using MapLibre GL with
  [OpenFreeMap](https://openfreemap.org) vector tiles (OpenStreetMap data, no key) and Mapzen terrain tiles on AWS
  Open Data for hill shading, recoloured to the site's palette. The route, pins and markers stay on the canvas above it.
- If the tiles can't load (no WebGL, offline, or a host that blocks other sites, like the claude.ai artifact viewer),
  the globe is used at every zoom.

## Hosting

Cloudflare Pages (free): connect this repo, build command `npm run build`, output directory `site`.

## Current data

Both grandfathers' stops come from `data/import/grandfathers_timeline.json` with their exact quoted sources (Lynda's booklet, newspapers, Young's 20th Battery history, the Edmondson article, The Quiet Service). Stops with only family sources are marked `family`; stops with a newspaper, book or record are `documented`. Clayton's troop after Ifs is recorded as a disagreement (`conflicts.csv`, c-1).

Next: run the war diary pipeline on the 2nd Anti-Tank Regiment diary (Héritage reels T-16452 and T-16453).

## Project '44

[Project '44](https://project44.ca/) maps Canadian units day by day from the war diaries. This repo is built so it can link to or import from it later:

- `units.csv` has a `project44_url` column. When filled in, the viewer links the unit to its Project '44 page.
- If Project '44 ever shares position data, it goes into `unit_locations.csv` with a source row of `kind` `project44`, credited on every position. Nothing else needs to change.
- Until then, unit positions come from our own reading of the war diaries.

## Adding a soldier from a family (the "Add a soldier" page)

`site/contribute.html` gives families a prompt (`site/submit/prompt.md`) to paste into their own AI along with their documents. The AI replies with one JSON object (format `soldier-paths/1`). The page checks it with `site/submit/check.mjs`, previews the route, and lets them download the file or paste it into a GitHub issue (`.github/ISSUE_TEMPLATE/soldier.yml`).

To bring a submission in:

    node scripts/import_submission.mjs path/to/name.soldier.json --dry-run   # see what it would add
    node scripts/import_submission.mjs path/to/name.soldier.json            # add as private
    npm run build

Imported soldiers are private until you change `privacy` to `public` in `data/soldiers.csv` (or import with `--public`). Facts the family marked as their own memory come in as `family`; everything else is `ai_draft`, because the family's AI wrote it. Units the site doesn't know yet are added to `data/units.csv` with no parent, for you to place in the hierarchy.
