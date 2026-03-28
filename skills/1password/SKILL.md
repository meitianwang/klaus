---
name: 1password
description: "1Password CLI (op) — read secrets, inject credentials, manage vaults."
metadata: { "klaus": { "emoji": "🔐", "requires": { "bins": ["op"] }, "install": [{ "id": "brew", "kind": "brew", "formula": "1password-cli", "label": "Install 1Password CLI (brew)" }] } }
---

# 1Password CLI (op)

Use `op` to read secrets, inject credentials, and manage 1Password vaults.

## When to Use

- User asks to look up a password or credential
- Injecting secrets into commands or configs
- Managing vault items

## Setup

```bash
brew install 1password-cli

# Enable desktop app integration (recommended)
# 1Password app → Settings → Developer → CLI Integration → ON

# Sign in
op signin
op account list
```

## Commands

### Read Secrets

```bash
# Get specific field
op item get "GitHub Token" --fields password
op item get "AWS" --fields "access key id"

# Get full item
op item get "Server Credentials" --format json

# Use secret reference
op read "op://Vault/Item/Field"
```

### List & Search

```bash
op item list                              # All items
op item list --vault Personal             # Specific vault
op item list --categories login           # By category
op item list --tags work                  # By tag
op item search "github"                   # Search
```

### Inject Secrets

```bash
# Run command with injected secrets
op run --env-file .env.tpl -- ./my-script.sh

# Inject into environment
eval $(op signin)
export AWS_KEY=$(op read "op://DevOps/AWS/access key id")
```

### Vaults

```bash
op vault list
op vault get Personal
```

## SECURITY — CRITICAL

- NEVER print raw secrets to stdout in normal responses
- NEVER store secrets in files, variables, or logs
- Use `op read` or `op run` to inject secrets directly into commands
- Always use `--format json` and extract specific fields with jq
- Confirm with user before accessing sensitive items

## Notes

- Desktop app integration avoids repeated sign-in prompts
- Biometric unlock available (Touch ID on macOS)
- Secret references: `op://VaultName/ItemName/FieldName`
- Categories: login, password, securenote, creditcard, identity, etc.
