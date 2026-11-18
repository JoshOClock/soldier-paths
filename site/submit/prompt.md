You are helping me add a Canadian soldier to Soldier Paths, a site that maps where Canadian soldiers went in the Second World War. I will give you documents about one soldier: service records, discharge papers, letters, newspaper clippings, obituaries, photos with captions, family notes or my own memories.

Read everything I give you, then reply with ONE JSON object in a single ```json code block, in exactly the format below. Nothing before or after the code block.

Rules:
1. Use only what is in my documents and what I tell you. Never fill gaps from general knowledge. If something isn't in the documents, leave it out or use null.
2. Every event needs a source from the "sources" list. For anything I told you myself, use a source with kind "family".
3. Put a short exact quote (under 25 words) from the document in "quote" wherever the document has words that support the event. For photos or my own words, describe briefly instead.
4. Dates: write them as the document gives them, in one of these forms: "1944-06-19", "19 Jun 1944", "Jun 1944", "1944", "Summer 1944", "Early Aug 1944", "Jul 1944 to Aug 1944", or "about 1943". Don't make a date more precise than the document.
5. Places: give the place name as written, plus your best latitude and longitude. If you're not sure of the exact spot, set "precision_km" larger (5 for a village, 20 for an area, 100 for "in Holland").
6. "confidence" is one of:
   - "documented": an official record or newspaper says it directly
   - "family": a family story, letter or memory
   - "estimated": you worked it out (for example, he was with his regiment, and the regiment was there)
7. Units: write the full unit name as the documents give it, for example "2nd Canadian Anti-Tank Regiment, RCA" or "Sherbrooke Fusilier Regiment". Include battery, company or troop if given.
8. Do not include anything about living people except my name and how I'm related.
9. If documents disagree, include both versions as separate events and say so in "note".

Format:

```json
{
  "format": "soldier-paths/1",
  "submitted_by": { "name": "", "relationship": "" },
  "soldier": {
    "name": "Full name as on his records",
    "known_as": "",
    "rank": "Highest rank reached",
    "service_number": "",
    "branch": "army | navy | air force",
    "born": { "date": "", "place": "" },
    "died": { "date": "", "place": "" },
    "hometown": ""
  },
  "units": [
    { "name": "", "from": "", "to": "", "role": "", "source": "s1", "confidence": "documented" }
  ],
  "events": [
    {
      "date": "",
      "kind": "birth | enlistment | training | posting | embarkation | location | battle | wounded | promotion | award | leave | return | discharge | death | other",
      "what": "One short line: what happened",
      "place": { "name": "", "lat": 0, "lon": 0, "precision_km": 5 },
      "source": "s1",
      "page": "",
      "quote": "",
      "confidence": "documented",
      "note": ""
    }
  ],
  "sources": [
    { "id": "s1", "kind": "service_file | newspaper | letter | photo | family | book | website | other", "title": "", "date": "", "url": "", "where_held": "" }
  ],
  "notes": "Anything important that didn't fit above"
}
```

List events in the order they happened. Start with his birth if known.
