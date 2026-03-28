---
name: tmux
description: "Remote-control tmux sessions — send keystrokes, scrape output, manage panes."
metadata: { "klaus": { "emoji": "🧵", "os": ["darwin", "linux"], "requires": { "bins": ["tmux"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "tmux", "label": "Install tmux (brew)" }] } }
---

# tmux

Remote-control tmux sessions for interactive CLIs.

## When to Use

- Running interactive CLI tools that need terminal input
- Monitoring long-running processes
- Managing multiple terminal sessions
- Automating interactive workflows

## Commands

### Session Management

```bash
tmux new-session -d -s mysession              # Create detached session
tmux list-sessions                             # List sessions
tmux kill-session -t mysession                 # Kill session
tmux attach -t mysession                       # Attach (interactive)
```

### Send Keys (Non-Interactive Automation)

```bash
# Type a command
tmux send-keys -t mysession "ls -la" Enter

# Send Ctrl+C
tmux send-keys -t mysession C-c

# Send special keys
tmux send-keys -t mysession Up Enter
tmux send-keys -t mysession Tab
```

### Capture Output

```bash
# Capture current pane content
tmux capture-pane -t mysession -p

# Capture with history (last 1000 lines)
tmux capture-pane -t mysession -p -S -1000

# Save to file
tmux capture-pane -t mysession -p > /tmp/output.txt
```

### Pane Management

```bash
tmux split-window -t mysession -h              # Split horizontal
tmux split-window -t mysession -v              # Split vertical
tmux select-pane -t mysession.1                # Switch pane
tmux resize-pane -t mysession -D 10            # Resize down
```

## Common Workflow: Run Interactive CLI

```bash
# 1. Create session
tmux new-session -d -s work

# 2. Send command
tmux send-keys -t work "python3 -i" Enter

# 3. Wait for prompt
sleep 1

# 4. Send input
tmux send-keys -t work "print('hello')" Enter

# 5. Capture output
tmux capture-pane -t work -p
```

## Notes

- Use `send-keys` + `capture-pane` for non-interactive automation
- Always use detached sessions (`-d`) for background work
- `capture-pane -p` outputs to stdout (pipeable)
- macOS + Linux only
