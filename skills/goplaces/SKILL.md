---
name: goplaces
description: "Query Google Places API — text search, place details, reviews."
metadata: { "klaus": { "emoji": "📍", "primaryEnv": "GOOGLE_MAPS_API_KEY", "requires": { "bins": ["goplaces"], "env": ["GOOGLE_MAPS_API_KEY"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "steipete/tap/goplaces", "label": "Install goplaces (brew)" }] } }
---

# goplaces — Google Places CLI

Query Google Places API for text search, place details, and reviews.

## When to Use

- User asks about restaurants, shops, services nearby
- Looking up a specific place (address, hours, rating)
- Finding places by type (cafe, gym, hospital)
- Reading reviews for a location

## Commands

### Text Search

```bash
goplaces search "coffee shops in San Francisco"
goplaces search "sushi near me" --max 5
goplaces search "gas station" --json
```

### Place Details

```bash
goplaces details <place-id>
goplaces details <place-id> --json
```

### Reviews

```bash
goplaces reviews <place-id> --max 10
```

### Resolve (Name → Place)

```bash
goplaces resolve "Starbucks Reserve Roastery Seattle"
```

## Output

Default: human-readable. Add `--json` for structured output with:
- `name`, `address`, `rating`, `userRatingsTotal`
- `openNow`, `priceLevel`, `types`
- `location` (lat/lng)
- `phone`, `website`, `url` (Google Maps link)

## Notes

- Requires `GOOGLE_MAPS_API_KEY` (Google Cloud Console → Places API)
- Results are location-aware if device location is available
- Rate limits apply (Google Maps Platform quotas)
