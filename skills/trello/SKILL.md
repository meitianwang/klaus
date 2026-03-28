---
name: trello
description: "Manage Trello boards, lists, and cards via REST API."
metadata: { "klaus": { "emoji": "📋", "primaryEnv": "TRELLO_API_KEY", "requires": { "env": ["TRELLO_API_KEY", "TRELLO_TOKEN"] } } }
---

# Trello

Manage Trello boards, lists, and cards via the REST API.

## When to Use

- User asks to create/move/update Trello cards
- Checking board status or task lists
- Organizing project tasks

## Setup

1. Get API key: https://trello.com/app-key
2. Generate token: click "Token" link on the API key page
3. Store both as environment variables or in Admin UI

## API Basics

```bash
TRELLO_KEY="$TRELLO_API_KEY"
TRELLO_TOKEN="$TRELLO_TOKEN"
BASE="https://api.trello.com/1"
AUTH="key=$TRELLO_KEY&token=$TRELLO_TOKEN"
```

## Commands

### Boards

```bash
# List your boards
curl -s "$BASE/members/me/boards?$AUTH" | jq '.[].name'

# Get board details
curl -s "$BASE/boards/{boardId}?$AUTH&lists=open" | jq '.lists[].name'
```

### Lists

```bash
# Get lists on a board
curl -s "$BASE/boards/{boardId}/lists?$AUTH" | jq '.[] | {id, name}'

# Create list
curl -s -X POST "$BASE/boards/{boardId}/lists?$AUTH&name=New+List"
```

### Cards

```bash
# Get cards in a list
curl -s "$BASE/lists/{listId}/cards?$AUTH" | jq '.[] | {id, name, due}'

# Create card
curl -s -X POST "$BASE/cards?$AUTH&idList={listId}&name=New+Task&desc=Details"

# Move card to another list
curl -s -X PUT "$BASE/cards/{cardId}?$AUTH&idList={newListId}"

# Update card
curl -s -X PUT "$BASE/cards/{cardId}?$AUTH&name=Updated+Name&due=2026-04-01"

# Add comment
curl -s -X POST "$BASE/cards/{cardId}/actions/comments?$AUTH&text=Comment+here"

# Delete card
curl -s -X DELETE "$BASE/cards/{cardId}?$AUTH"
```

### Labels

```bash
# Get board labels
curl -s "$BASE/boards/{boardId}/labels?$AUTH" | jq '.[] | {id, name, color}'

# Add label to card
curl -s -X POST "$BASE/cards/{cardId}/idLabels?$AUTH&value={labelId}"
```

## Notes

- Board/list/card IDs are 24-char hex strings
- Dates in ISO 8601 format
- Rate limit: 100 requests per 10-second window per token
- URL-encode special characters in names/descriptions
