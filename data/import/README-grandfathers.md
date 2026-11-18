# Two Canadian soldiers: sample data for the spec

Real test data from a family-history prototype. Use it to shape the data model and test the "close by" logic. It is not a full set of service records.

## Files
- `grandfathers_timeline.json`: every dated stop for both men. Each stop has a date, a decimal year, a headline, a place, approximate coordinates, and the exact quoted sources (booklet, newspapers, war diary, book, article). It also has the hand-written "close by" comparisons and both birth dates.
- The live prototype (map, timeline, both soldiers): https://claude.ai/artifact/3cXHvZA21m9yzddYw6Jbnm

## Soldier 1: Clayton Truan Brown
- Born Jan. 13, 1920, Red Deer, Alberta.
- Enlisted Sept. 1939, Calgary. 23rd Battery, 2nd Canadian Anti-Tank Regiment, RCA, 2nd Canadian Infantry Division. Rose to sergeant.
- Troops: K troop until it was destroyed at Ifs on July 20, 1944, then J troop.
- Home on the Île de France, Aug. 1945. Demobbed in Calgary, Sept. 12, 1945. Later lived in Lacombe, Alberta.
- Service file: requested from Library and Archives Canada, not received yet.
- Sources used:
  - his wife Lynda's typed booklet, written from interviews with him
  - Lacombe Globe and Red Deer Advocate clippings
  - Edmonton Bulletin, Aug. 7, 1945
  - the 2nd Anti-Tank Regiment war diary on Héritage (reels T-16452 and T-16453)
  - Bruce W. Young, *20th Battery, 2 Antitank ... A Personal View* (2025)
  - Edmondson, "The Pawns of War," *Canadian Military History* 14:4 (2005)
  - Galt Museum photos P19800097000 and P19991039099

## Soldier 2: Gordon Carlyle Sweet, M.B.E.
- Born Feb. 23, 1914, Yellow Grass, Saskatchewan. Service number M29601.
- Enlisted Oct. 3, 1941, Edmonton. Commissioned six weeks later.
- Quartermaster, 17th (Light) Field Ambulance, RCAMC, the medical unit of the 2nd Canadian Armoured Brigade.
- Overseas June 1943 to Feb. 1946. In Normandy from about June 19, 1944, then northwest Europe to the end of the war.
- M.B.E.: Canada Gazette, Dec. 15, 1945; London Gazette, Jan. 24, 1946, p. 632.
- Service file: the family holds the 160-page Library and Archives Canada release. It is summarized in "The Quiet Service of Captain Gordon Carlyle Sweet, M.B.E." The family can share the original pages if needed.
- Unit war diary and M.B.E. recommendation: requested, not received.

## Things this data shows that the design must handle
- Most of each man's route comes from his unit's movements. Personal sources mostly add colour and a few exact dates.
- Dates are often fuzzy ("Winter 1944", "1943 to 1944") and places are sometimes unknown, such as Gordon's camp in England.
- Sources disagree. For example, the booklet and Clayton's father's obituary give different birth and homestead dates.
- "Close by" is about the units, never proof the men met.
