# Nightly unit-path job

A scheduled Claude task runs this once a night. Each run adds dated unit locations for one slice of the
official history, on a branch, for Josh to review. It never touches `main`.

## What a run does

1. Clone `JoshOClock/soldier-paths`, check out (or create) the branch `auto/unit-paths`, and merge `main` into it.
2. Read `data/import/pipeline_state.json` to find the next chapter to process. If the file doesn't exist,
   start at chapter 5 of the queue below.
3. Read that chapter with WebFetch (the pages are long: keep reading with `offset` until the end).
4. For every unit in `data/units.csv` (and their sub-units) that the chapter places somewhere on a date,
   add a row to `data/unit_locations.csv`:
   - `location_id`: `ul-<unit_id>-<yyyymmdd>-<n>`
   - `date_from` / `date_to`: as precise as the text allows (`19 Jul 1944`, `Jul 1944`, `19 Jul 1944 to 21 Jul 1944`)
     For a single day, set `date_to` the same as `date_from`: an empty `date_to` means "from then on".
   - `place_id`: an existing place from `data/places.csv`, or a new one added there with lon/lat.
     Only use coordinates you are confident of (a named village or town). If the text names an area
     ("south of Caen"), use the nearest named place and widen `precision_km` (5 to 15).
   - `source_id`: `src-stacey-victory` (add it to `data/sources.csv` if missing:
     kind `book`, title `C.P. Stacey, The Victory Campaign (Official History of the Canadian Army in the Second World War, Vol. III), 1960`,
     url `https://ibiblio.org/hyperwar/UN/Canada/CA/Victory/index.html`)
   - `page_ref`: the chapter and printed page if shown, e.g. `ch. VII, p. 183`
   - `quote`: the shortest phrase from the text that supports the row (under 15 words)
   - `extracted_by`: `claude-nightly`
   - `confidence`: `documented` if the text names this unit at this place on this date;
     `inferred` if you are placing it from its brigade or division
   - `status`: `ai_draft`
5. Add units the chapter names that are missing from `data/units.csv`, but only within the formations already
   there (2nd Canadian Infantry Division, 2nd Canadian Armoured Brigade, their brigades, regiments and battalions).
   Use the official short names. Leave `project44_url` blank.
6. Run `npm ci && npm run build`. Fix any validation errors the build reports. Never delete or change rows
   another run or a person wrote; only add.
7. Update `data/import/pipeline_state.json` (`{"next_chapter": N, "runs": [{"date", "chapter", "rows_added"}]}`).
8. Commit with a message listing the chapter and the number of rows added, and push the branch.
   Cloudflare Pages builds a preview of the branch at `https://auto-unit-paths.soldier-paths.pages.dev`.
9. Finish with a short summary: chapter read, rows added per unit, close-by notes drafted, anything uncertain.

Stop after one chapter. If the chapter queue is finished, skip steps 3 to 5 and go straight to the close-by notes below.

## Close-by notes (every run, after the chapter)

The build finds every stretch where two public soldiers were within about 10 km (`site/data/closeby.json`).
Episodes with `"human_note": null` only have a dry template note. Draft a better one for up to 5 of them per run,
oldest war date first:

1. Read both men's stories around the episode's dates: their events and quotes in `site/data/soldier/<id>.json`
   (unit stops have ids starting `u:`; their location id is the part after `u:`).
2. Write 2 to 4 plain sentences in the style of the existing notes in `data/closeby_notes.csv`: what each man
   (or his unit) was doing, and what links them (same battle, same brigade, same town). Use only facts already in
   the site's data, and name the place and date.
3. Never say or suggest they met, saw each other or knew each other unless a record in the data says so. End with
   what isn't known, for example "Whether they crossed paths isn't recorded."
4. Add a row to `data/closeby_notes.csv`: `note_id` `cb-auto-<n>`, the two soldier ids, `events_a` / `events_b`
   set to the episode's `facts` (event ids, or unit location ids without the `u:`), a short `title`
   ("about 6 km apart", "the same battle"), the `text`, `source_id` empty, and `status` `ai_draft`.
5. Run `npm run build` again and check the note attached to the episode (the build warns if a note matches nothing).

Never edit or replace a note someone else wrote.

## Chapter queue

Base URL: `https://ibiblio.org/hyperwar/UN/Canada/CA/Victory/`

| N | File | Covers |
|---|------|--------|
| 5 | Victory-5.html | D-Day, 6 June 1944 |
| 6 | Victory-6.html | Bridgehead, 7 to 30 June |
| 7 | Victory-7.html | Caen and Bourguébus, 1 to 23 July |
| 8 | Victory-8.html | Breakout begins, 24 to 31 July |
| 9 | Victory-9.html | Falaise road, 1 to 12 August |
| 10 | Victory-10.html | Falaise, 12 to 23 August |
| 12 | Victory-12.html | Seine, 23 to 30 August |
| 14 | Victory-14.html | Coastal belt and ports, September |
| 15 | Victory-15.html | Scheldt I |
| 16 | Victory-16.html | Scheldt II |
| 17 | Victory-17.html | Winter on the Maas |
| 18 | Victory-18.html | Rhineland I, Veritable |
| 19 | Victory-19.html | Rhineland II, Blockbuster |
| 20 | Victory-20.html | Rhine crossing, advance to the North Sea |
| 21 | Victory-21.html | Western Netherlands |
| 22 | Victory-22.html | German surrender |

## Later sources (not yet in the job)

- War diaries on Héritage (images only, no text). Needs a run on a computer with a browser, and the
  Canadiana image server was not responding when tested on 2026-11-18.
- CMHQ reports (Directorate of History and Heritage), unit-level detail, PDF.
