# Nightly unit-path job

A scheduled Claude task runs this once a night. It works **on demand**: it only gathers locations for units that
soldiers on the site actually belong to, one chapter of the official history per run. Each run's work goes on a
branch for Josh to review. It never touches `main`.

## Which units ("wanted units")

1. Every posting in `data/postings.csv` (any soldier, public or private) names a unit and dates.
2. The wanted units are those posting units **plus their parents up to division level** (follow `parent_id` in
   `data/units.csv`), each with the posting's dates. The official history rarely names batteries or companies, so
   the regiment, brigade and division are where most rows will come from.
3. Units whose postings fall outside North-West Europe (Italy, Hong Kong, Canada only) have no source in this job yet.
   List them in the summary and skip them.

## What a run does

1. Clone `JoshOClock/soldier-paths`, check out (or create) the branch `auto/unit-paths`, and merge `main` into it.
2. Read `data/import/pipeline_state.json` (create it if missing). It records, per chapter, which units have been
   extracted: `{"done": {"7": ["2-cdn-inf-div", "2-cdn-atk-regt"]}, "runs": [...]}`.
3. Work out the wanted units (above). Pick the **one** chapter from the queue below, earliest in the war first, whose
   dates overlap a wanted unit's posting dates and that hasn't been done for that unit yet. Postings for soldiers
   added most recently come first if there's a choice. If there's nothing left to do, skip to the soldier records.
4. Read that chapter with WebFetch (the pages are long: keep reading with `offset` until the end).
5. For each wanted unit that overlaps the chapter, every time the text places it somewhere on a date, add a row to
   `data/unit_locations.csv`:
   - `location_id`: `ul-<unit_id>-<yyyymmdd>-<n>`
   - `date_from` / `date_to`: as precise as the text allows. For a single day, put the same date in both
     (an empty `date_to` means open-ended).
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
   - `summary`: one short line in your own words on what the unit was doing there (under 12 words), e.g.
     `Supported the Queen's Own Rifles in the assault on Bernières`. This is the headline people read.
6. If the text names a sub-unit of a wanted unit (a regiment's battery, a brigade's battalion) that a soldier's
   posting points to, use that sub-unit. Don't add units nobody belongs to.
7. Run `npm ci && npm run build`. Fix any validation errors the build reports. Never delete or change rows
   another run or a person wrote; only add.
8. Record the chapter and units in `pipeline_state.json` (`done` plus a `runs` entry: date, chapter, units, rows_added).
9. Commit with a message listing the chapter, units and number of rows, and push the branch.
   Cloudflare Pages builds a preview of the branch at `https://auto-unit-paths.soldier-paths.pages.dev`.

**One chapter per run. Stop after it**, then do the soldier records, close-by notes and archive photos below. Don't start a second chapter even if
there's time left.

## Soldier records (every run, after the chapter)

Look up up to **2** soldiers per run in public records about one man. Newest soldiers first: any public soldier in
`data/soldiers.csv` not yet in `pipeline_state.json` `"soldiers_checked"`. Skip soldiers marked `private`.

Where to look, in this order (WebSearch, then fetch the pages):
1. **Died in service, 1939 to 1947** (a `death_date` in those years, or a record turns one up):
   - Canadian Virtual War Memorial (veterans.gc.ca): unit, death date, cemetery, sometimes photos and clippings.
   - Commonwealth War Graves Commission (cwgc.org): unit, service number, grave, next of kin.
   - LAC "Second World War Service Files – War Dead" (recherche-collection-search.bac-lac.gc.ca): the file reference,
     and the digitized file when it opens without a sign-in.
   - Faces to Graves (facestograves.nl, Groesbeek), A Face for Every Name (Holten), Bergen op Zoom: life stories
     for men buried in the Netherlands.
2. **Everyone:**
   - Royal Canadian Legion Military Service Recognition Books (provincial flip-books online: Ontario, Nova Scotia,
     New Brunswick, Manitoba, BC/Yukon). Short biographies sent in by families.
   - The Memory Project (thememoryproject.com): veteran interviews.
   - Honours and awards: Canada Gazette and London Gazette lists, newspaper award notices.
   - Local newspapers and obituaries (Peel's Prairie Provinces, Internet Archive, Google News Archive).

Rules:
1. **Same man, or nothing.** Only use a record when it matches on service number, or on full name plus at least two
   of: birth date or year, hometown, unit, next of kin. If it's a maybe, put it in the summary for Josh as a
   possible match with its link, and add nothing to the data.
2. Add only. Never change or remove a row a family or another run wrote. If a record disagrees with an existing row,
   add a row to `data/conflicts.csv` and say so in the summary.
3. Each record used gets a row in `data/sources.csv`: `source_id` `src-<site>-<soldier_id>` (e.g.
   `src-cvwm-harold-philp`), `kind` (`archival`, `newspaper`, `book`, `oral_history`, `article`), a title, the page
   `url`, and `rights` if the page states reuse terms.
4. New events in `data/events.csv` (`birth`, `enlistment`, `location`, `promotion`, `award`, `wound`, `death`,
   `burial`, `discharge`, `marriage`): `confidence` `documented`, `status` `ai_draft`, `detail` in your own words
   (under 15 words), dates as precise as the record. Places as in the chapter step.
5. New postings in `data/postings.csv` only when the record names the unit; dates as the record gives them.
6. Legion books, Faces to Graves and Memory Project pages are other people's writing: take the facts and link the
   page. No quotes longer than a short phrase, and no copied photos. A photo goes in `data/photos.csv` only under the
   archive-photo rules below.
7. Record each soldier as `"soldiers_checked": {"<soldier_id>": "<date>"}`, even if nothing was found, and list
   what was searched in the summary.
8. Run `npm run build` again to check the rows.

## Chapter queue

Base URL: `https://ibiblio.org/hyperwar/UN/Canada/CA/Victory/`

| N | File | Dates covered |
|---|------|---------------|
| 5 | Victory-5.html | 6 Jun 1944 |
| 6 | Victory-6.html | 7 to 30 Jun 1944 |
| 7 | Victory-7.html | 1 to 23 Jul 1944 |
| 8 | Victory-8.html | 24 to 31 Jul 1944 |
| 9 | Victory-9.html | 1 to 12 Aug 1944 |
| 10 | Victory-10.html | 12 to 23 Aug 1944 |
| 12 | Victory-12.html | 23 to 30 Aug 1944 |
| 14 | Victory-14.html | 1 to 30 Sep 1944 (coast and ports) |
| 15 | Victory-15.html | Sep to Oct 1944 (Scheldt I) |
| 16 | Victory-16.html | Oct to Nov 1944 (Scheldt II) |
| 17 | Victory-17.html | 9 Nov 1944 to 7 Feb 1945 |
| 18 | Victory-18.html | 8 to 21 Feb 1945 (Veritable) |
| 19 | Victory-19.html | 22 Feb to 10 Mar 1945 (Blockbuster) |
| 20 | Victory-20.html | 23 Mar to 5 May 1945 (Rhine to the North Sea) |
| 21 | Victory-21.html | 1 to 22 Apr 1945 (Western Netherlands) |
| 22 | Victory-22.html | 1 to 8 May 1945 |

Earlier runs (chapters 5 to 8) extracted the whole 2nd Armoured Brigade and parts of the 2nd Division. Count those
chapters as done for the units they cover; check `data/unit_locations.csv` rather than re-reading.

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

## Archive photos (every run, after the close-by notes)

Find up to **8** archive photos per run to show as camera icons on the map (`data/photos.csv`). Work through the
places and dates the site already covers, earliest first, and keep going back over chapters done before this step
existed (5 onward) until they're covered. Record progress in `pipeline_state.json` as
`"photos_done": ["ch5", "ch6", ...]` (a chapter counts as done once its main places have been searched).

Where to look (search with WebSearch, then fetch the result pages):
- Imperial War Museums (iwm.org.uk): the Army Film & Photographic Unit series (catalogue numbers B, BU, A).
- Library and Archives Canada (recherche-collection-search.bac-lac.gc.ca): Canadian Army photos (MIKAN numbers).
- Wikimedia Commons copies of IWM and LAC photos, which give the archive number and date.

Rules:
1. Only add a photo when its archive record names the place (or the place is unmistakable from the record) and gives a
   date or a date range. Prefer photos of Canadian units, and of the units soldiers on the site belong to.
2. Use the archive's own page for `page_url` and the archive's own image link for `image_url` (for IWM, the
   `media.iwm.org.uk` link shown on the item page; for Commons, the file's direct upload.wikimedia.org link).
   Don't download or copy images into the repo.
3. `credit` exactly as the archive asks (IWM: `Image: IWM (B 8910)`; LAC: `Library and Archives Canada, MIKAN 1234567`).
   `licence`: `IWM Non-Commercial Licence`, `Public domain`, or what the record says. Skip anything marked
   all rights reserved or without a clear reuse statement.
4. `caption`: one or two sentences in your own words from the record (no long quotes). `date` as precise as the
   record allows (`19 Jul 1944`, `Jul 1944`, `late Jul 1944`). `note`: photographer or unit, and anything uncertain.
5. Prefer photos that match a unit location already on the site (same place, within a few days): those show inside
   the unit's and its soldiers' stories as well as on the map.
6. `lon`/`lat` for the named place; `precision_km` 1 for a town, 5 to 10 for "near" or "south of".
7. `photo_id`: `iwm-b-8910`, `lac-3563575`, and so on. Never add a photo that's already in the file.
8. Run `npm run build` again to check the rows.

## Later sources (not yet in the job)

- War diaries on Héritage (images only, no text). Needs a run on a computer with a browser, and the
  Canadiana image server was not responding when tested on 2026-11-18.
- CMHQ reports (Directorate of History and Heritage), unit-level detail, PDF.

## Finishing

Push the branch after all four steps. End with a short plain-language summary for Josh: chapter and units, locations added,
soldiers looked up (what was found, possible matches with links), close-by notes drafted, photos added (with places),
and anything you weren't sure about.
