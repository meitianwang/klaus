---
name: cron-manager
description: Create and manage scheduled/recurring tasks (cron jobs) on behalf of the user.
metadata: { "klaus": { "emoji": "⏰", "always": true } }
---

# cron-manager

Create, edit, and manage scheduled tasks (cron jobs) for the user. When a user asks you to do something on a schedule — "每天推送新闻", "每周一提醒我写周报", "5分钟后提醒我开会" — use this skill to create a cron task.

## When to Use

- User asks to schedule a recurring task: "每天早上9点给我推送新闻"
- User asks for a timed reminder: "5分钟后提醒我"
- User asks to set up periodic reports: "每周五下午发送周报"
- User says "定时", "提醒我", "每天/每周/每月", "remind me", "schedule", "every day/week" etc.
- User wants to modify or cancel an existing scheduled task

## How It Works

Include `[[cron:action {json}]]` markers in your reply. The system extracts and executes them automatically, then strips them from the displayed message.

### Create a task

```
[[cron:add {"id":"unique-id","schedule":"cron-or-time-expr","prompt":"what Claude should do when triggered","name":"human-readable name"}]]
```

### Edit a task

```
[[cron:edit {"id":"existing-id","schedule":"new-schedule","prompt":"new prompt"}]]
```

### Remove a task

```
[[cron:remove {"id":"existing-id"}]]
```

### Enable / disable a task

```
[[cron:enable {"id":"existing-id"}]]
[[cron:disable {"id":"existing-id"}]]
```

## Schedule Formats

| Format | Example | Meaning |
|--------|---------|---------|
| Cron expression | `0 9 * * *` | Every day at 9:00 AM |
| Cron expression | `0 9 * * 1` | Every Monday at 9:00 AM |
| Cron expression | `*/30 * * * *` | Every 30 minutes |
| Cron expression | `0 9,18 * * *` | Every day at 9:00 and 18:00 |
| Relative time | `5m` | 5 minutes from now (one-shot) |
| Relative time | `1h` | 1 hour from now (one-shot) |
| Relative time | `2h30m` | 2 hours 30 minutes from now |
| ISO 8601 | `2025-12-31T23:59:00` | Specific date/time (one-shot) |

## Rules

1. **Always generate a descriptive `id`** — use lowercase, dashes, no spaces. E.g., `daily-news`, `weekly-report`, `meeting-reminder-3pm`
2. **Always include a `name`** — a human-readable label in the user's language
3. **The `prompt` is what Claude receives when the task fires** — write a clear, complete prompt. Include context the AI will need since it runs in a separate session
4. **Include `deliver` for tasks that should send results to the user**:
   ```json
   {"channel": "web", "to": "*"}
   ```
   Without `deliver`, the task runs silently (no output sent to user)
5. **For one-shot tasks** (relative time or ISO 8601), the task auto-deletes after running
6. **Strip the marker from your visible reply** — explain what you did in natural language

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Override the AI model for this task |
| `lightContext` | boolean | Use minimal system prompt (faster, cheaper) |
| `timeoutSeconds` | number | Task execution timeout (default: 600, 0=unlimited) |

## Examples

### User: "每天早上9点给我推送科技新闻"

```
好的，我已为你创建了每日科技新闻推送任务！每天早上9:00会自动搜索并推送最新科技资讯。

[[cron:add {"id":"daily-tech-news","name":"每日科技新闻","schedule":"0 9 * * *","prompt":"Search for today's top tech news from major sources. Summarize the 5 most important stories with headlines, brief descriptions, and source links. Write in Chinese.","deliver":{"channel":"web","to":"*"}}]]
```

### User: "10分钟后提醒我开会"

```
好的，10分钟后会提醒你开会。

[[cron:add {"id":"meeting-reminder","name":"开会提醒","schedule":"10m","prompt":"提醒用户：该开会了！请尽快准备并加入会议。","deliver":{"channel":"web","to":"*"}}]]
```

### User: "取消每日新闻推送"

```
已取消每日科技新闻推送任务。

[[cron:remove {"id":"daily-tech-news"}]]
```

### User: "把新闻推送改到下午6点"

```
已将科技新闻推送时间调整为每天下午6:00。

[[cron:edit {"id":"daily-tech-news","schedule":"0 18 * * *"}]]
```
