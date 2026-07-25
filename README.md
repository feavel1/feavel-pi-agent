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

## Architecture

### Packages (active)

| Package | Provides |
|---------|----------|
| `npm:pi-web-access` | `librarian` skill — research open-source libraries with source citations |
| `npm:pi-subagents` | `pi-subagents` skill + built-in agents (scout, planner, worker, reviewer, oracle, researcher, context-builder, delegate) |
| `npm:opencode-ponytail` | `ponytail` family — caveman-style code simplification; `ponytail-review`, `ponytail-audit`, `ponytail-debt`, `ponytail-help` |
| `npm:pi-mcp-adapter` | MCP protocol adapter — bridges `@sveltejs/mcp` for official Svelte docs |
| `npm:@quintinshaw/pi-dynamic-workflows` | `workflow` tool + 5 built-in patterns (deep-research, adversarial-review, code-review, multi-perspective, codebase-audit) + `workflow-patterns`/`workflow-authoring` skills |

### Removed packages (kept for reference)

| Package | Why removed |
|---------|-------------|
| `@vigolium/piolium` | 20 cybersecurity audit skills — niche, not needed for Svelte dev |
| `@spences10/pi-skills` | Skill manager CLI — unused |
| `@spences10/pi-svelte-guardrails` | Blocks `$effect` entirely — too aggressive, counterproductive |
| `git:github.com/jonjonrankin/pi-caveman` | Duplicate of user-installed `caveman` skill |

### MCP Servers

- **svelte** (`npx @sveltejs/mcp`) — official Svelte 5 + SvelteKit docs, autofixer, playground. Direct tools exposed: `svelte_get-documentation`, `svelte_list-sections`, `svelte_svelte-autofixer`, `svelte_playground-link`, `svelte_read_playground_link_ui`

### Skills (user-installed)

| Skill | Purpose |
|-------|---------|
| `caveman` | Ultra-compressed communication mode (~75% fewer tokens) |
| `tdd` | Test-driven development: red-green-refactor loop |
| `svelte-core-bestpractices` | Svelte 5 core rules + routes to MCP for detailed docs |
| `browser-tools` | Chrome DevTools Protocol — interactive browser automation |

**Svelte docs strategy:** Only `svelte-core-bestpractices` is kept as a skill. All detailed Svelte 5/SvelteKit documentation (runes, styling, routing, data flow, remote functions, deployment, etc.) comes from the official Svelte MCP server via `svelte_get-documentation`. Skills were redundant with MCP and removed.

### Removed skills (kept for reference)

| Skill | Why removed |
|-------|-------------|
| `svelte-runes` | MCP provides `$state`, `$derived`, `$effect` docs |
| `svelte-template-directives` | MCP provides `{@attach}`, `{@render}`, snippets docs |
| `svelte-styling` | MCP provides scoped CSS, `:global`, custom properties docs |
| `svelte-components` | MCP + library-specific docs cover this |
| `svelte-deployment` | MCP provides adapters, Vite config, PWA docs |
| `sveltekit-data-flow` | MCP provides load functions, form actions docs |
| `sveltekit-structure` | MCP provides routing, layouts, error handling docs |
| `sveltekit-remote-functions` | MCP + experimental nature makes skill-prone staleness |
| `svelte-layerchart` | 3rd-party lib, not Svelte core |
| `svelte-code-writer` | Workflow boils down to "call MCP autofixer" |
| `vscode` | Trivial — just `code -d` command |
| `diagnose` | Niche debugging loop, rarely triggered |
| `grill-me` / `grill-with-docs` | Interview-style planning, rarely used |
| `impeccable` | Massive UI polish skill (~80 files), not needed |
| `improve-codebase-architecture` | Niche architecture review |
| `proto-logic` / `proto-ui` | Throwaway prototype builders, rarely used |
| `to-issues` | Plan-to-issues converter, rarely used |
| `write-a-skill` | Skill authoring, rarely used |

### Extension

- **pi-sync** — `/sync-push`, `/sync-pull`, `/sync-status` commands + `pi_sync` LLM tool. Syncs extensions, skills, prompts, settings.json, mcp.json to git remote.

## Workflows & Subagents

### How the `workflow` tool works

`pi-dynamic-workflows` adds a `workflow` tool that runs JavaScript orchestrator scripts. The script calls `agent()` to spawn subagents, `parallel()` to fan out work, and `pipeline()` for staged processing. Runs execute asynchronously (background) by default — the tool returns immediately and results are delivered when the workflow finishes.

**5 built-in patterns** (callable via `workflow({ name, args })`):

| Name | Use case | Args |
|------|----------|------|
| `deep-research` | Research question across web, cross-check sources | `{ question, angles?, minSupport? }` |
| `adversarial-review` | Investigate claim, cross-check with skeptical reviewers | `{ task, reviewers?, threshold? }` |
| `code-review` | Multi-angle diff review (correctness, reuse, simplicity, efficiency) | `{ diff, diffSource? }` |
| `multi-perspective` | Analyze topic from independent perspectives, synthesize | `{ topic, perspectives? }` |
| `codebase-audit` | Parallel checks against codebase, cross-validate | `{ scope, checks }` |

### How subagents work

`pi-subagents` provides the `subagent` tool. Launch agents with roles:

**Built-in agents:**
| Agent | Role |
|-------|------|
| `scout` | Fast codebase recon → writes context.md |
| `planner` | Creates implementation plans → writes plan.md |
| `worker` | Implementation — single writer, escalates decisions |
| `reviewer` | Review-and-fix specialist |
| `context-builder` | Requirements/codebase handoff builder |
| `researcher` | Web research brief generator → writes research.md |
| `oracle` | Decision-consistency advisory review (forked context) |
| `delegate` | Lightweight generic delegate |

**Execution modes:**
- **Single:** `subagent({ agent: "reviewer", task: "..." })`
- **Parallel fan-out:** `subagent({ tasks: [{ agent, task }, ...], concurrency: 3 })`
- **Chain:** `subagent({ chain: [{ agent: "scout", task: "..." }, { agent: "planner", task: "..." }, { agent: "worker", task: "..." }] })`
- **Async:** `subagent({ agent: "worker", task: "...", async: true })` — launch and continue

**Key patterns:**
- Use `context: "fresh"` for reviewers/validators — clean slate, no parent history pollution
- Use `context: "fork"` for oracle/worker — inherits parent session for context
- One writer per worktree. Fan out read-only reviewers, synthesize parent-side, then one fixer worker
- Review loop: worker → parallel reviewers → parent synthesis → fixer worker → repeat until clean
- Use `output` + `outputMode: "file-only"` for large artifacts

**Model override:** `subagent({ agent: "reviewer", model: "anthropic/claude-sonnet-4", task: "..." })`

### When to use workflows vs subagents

| Scenario | Tool |
|----------|------|
| Simple delegation (review this, scout that) | `subagent` directly |
| Multi-step orchestration with fan-out/fan-in | `workflow` with custom `script` |
| Fits a built-in pattern (research, audit, multi-review) | `workflow({ name: "..." })` |
| Need dynamic fan-out (expand results into parallel tasks) | `workflow` script with `expand` |
| Need quality gates (verify, judgePanel) | `workflow` script with helpers |

## Design Principles

- **Minimal packages** — 5 active packages. Security audit, guardrails, skill manager removed.
- **Skills over prompts** — empty prompts dir; all guidance in skills (4 user skills + ~13 package skills).
- **MCP over skills for docs** — Svelte MCP server provides official docs; only `svelte-core-bestpractices` kept as router.
- **Sync everything except machine-specific config** — pi-sync's config.json is local-only.
- **No nested .git or node_modules in sync** — extension skips these to avoid permission errors.

### Known sync caveats

- **Deletions are not auto-synced.** The push command copies files in but doesn't remove stale files from the repo. After deleting skills locally, run `cd ~/.pi-sync && git add -A && git commit -m "cleanup" && git push`.
- **Reload after pull.** Run `/reload` to pick up new extensions and skills.
