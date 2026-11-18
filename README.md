# Soldier Paths

Look up a Canadian soldier, follow his path through the war on a map and timeline, compare soldiers, and see when their paths came close.

Starts with Clayton Brown (23rd Battery, 2nd Anti-Tank Regiment, 2nd Canadian Infantry Division) and Gordon Sweet (RCAMC, 2nd Canadian Armoured Brigade), then grows through their formations one war diary at a time.

## How it works

- `data/*.csv` is the source of truth. Edit in a spreadsheet or text editor.
- `npm run build` checks the data, works out each soldier's day-by-day track and the close-by moments, and writes JSON to `site/data/`.
- `site/` is a static site that reads that JSON. `npm run serve` builds and serves it locally.

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

## Hosting

Cloudflare Pages: build command `npm run build`, output directory `site`.

## Current data

Both grandfathers' places and dates were imported from the Two Grandfathers' War prototype, marked `family`. Next step: confirm against service files and war diaries, and add sources.

## Project '44

[Project '44](https://project44.ca/) maps Canadian units day by day from the war diaries. This repo is built so it can link to or import from it later:

- `units.csv` has a `project44_url` column. When filled in, the viewer links the unit to its Project '44 page.
- If Project '44 ever shares position data, it goes into `unit_locations.csv` with a source row of `kind` `project44`, credited on every position. Nothing else needs to change.
- Until then, unit positions come from our own reading of the war diaries.
