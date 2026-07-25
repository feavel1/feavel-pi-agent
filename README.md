# Pi Sync Dotfiles

Pi config backup & sync across devices via git.

**This repo is both:**
- A **pi-installable package** (`@feavel/pi-sync`) — install anywhere to get the `/sync-*` commands
- Your **sync destination** — your actual extensions, skills, prompts, settings live here

## Install

On **any** machine with pi:

```bash
pi install https://github.com/feavel1/feavel-pi-agent.git
```

Then reload:

```
/reload
```

Then configure your sync target (usually this same repo):

```
/sync-setup
```

Enter this repo URL, then `main` for branch.

## Usage

| Command | Action |
|---------|--------|
| `/sync-push` | Push local config to this repo |
| `/sync-pull` | Pull config from this repo |
| `/sync-status` | Show config & file sizes |
| `/reload` | Reload pi after pull |

### Via agent (LLM tool)

```
pi_sync({action:'push'|'pull'|'status'})
```

## What Gets Synced

| Path | Description |
|------|-------------|
| `extensions/` | Pi agent extensions (`.ts` files) |
| `skills/` | Agent skills |
| `prompts/` | Custom prompt templates (`.md`) |
| `settings.json` | Agent settings, theme, packages list |
| `mcp.json` | MCP server configuration |

**Not synced:** `extensions/pi-sync/config.json` — machine-specific remote/branch config stays local.

## New Machine Setup (full)

```bash
pi install https://github.com/feavel1/feavel-pi-agent.git
/reload
/sync-setup     # paste repo URL, use "main"
/sync-pull      # restore all config
/reload         # apply
```
