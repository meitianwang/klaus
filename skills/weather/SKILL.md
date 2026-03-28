---
name: weather
description: "Get current weather and forecasts via wttr.in. No API key needed."
metadata: { "klaus": { "emoji": "☔", "always": true } }
---

# Weather

Get current weather conditions and forecasts via wttr.in.

## When to Use

- "What's the weather?"
- "Will it rain today/tomorrow?"
- "Temperature in [city]"
- "Weather forecast for the week"

## Commands

### Current Weather

```bash
# One-line summary
curl -s "wttr.in/London?format=3"

# Detailed current conditions
curl -s "wttr.in/London?0"

# Custom format
curl -s "wttr.in/London?format=%l:+%c+%t+(feels+like+%f),+%w+wind,+%h+humidity"
```

### Forecasts

```bash
# 3-day forecast
curl -s "wttr.in/London"

# Week forecast
curl -s "wttr.in/London?format=v2"

# Specific day (0=today, 1=tomorrow, 2=day after)
curl -s "wttr.in/London?1"
```

### Format Codes

| Code | Meaning |
|------|---------|
| `%c` | Weather emoji |
| `%t` | Temperature |
| `%f` | Feels like |
| `%w` | Wind |
| `%h` | Humidity |
| `%p` | Precipitation |
| `%l` | Location |

### Output Formats

```bash
# JSON
curl -s "wttr.in/London?format=j1"

# PNG image
curl -s "wttr.in/London.png" -o weather.png
```

## Notes

- No API key needed
- Rate limited; don't spam requests
- Supports city names, airport codes (`ORD`), coordinates
- Spaces in city names: use `+` (`New+York`)
