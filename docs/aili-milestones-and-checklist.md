# AILI — Milestones, Build Checklist, Accounts & Claude Code Guide (v0.3, Oct 9 2026)

Scope: a **fresh build** of the platform shell with **robotics as the only module**, and **two stages** (Learn stage + Build Workbench) on one shared engine (see `aili-stage-layout.md`). Lucky: do not tailor the plan to the YC deadline; deliver what we have, honestly labelled. (YC Winter 2027 deadline was reported as Nov 2 2026 — confirm on ycombinator.com if applying.)

**Source-of-truth order for Claude Code:** (1) `aili-professor-behavior-spec.md` v0.2; (2) `aili-stage-layout.md` and `aili-brand-design-language.md`; (3) `aili-architecture.md` v0.2; (4) `aili-visuals-curriculum-billing.md`. The folder is empty: Claude Code proposes the stack and structure for approval first.

## Milestones

**M0 — Foundations**
- [ ] Claude Pro, Claude Code installed and signed in (done)
- [ ] `git init`, private GitHub repo, `CLAUDE.md` and `docs/` in place
- [ ] Stack and folder structure proposed and approved
- [ ] `design/tokens.css` (light + dark), self-hosted Newsreader + Inter, SVG logo set
- [ ] Hosting, database and auth projects created by you; keys server-side only, `.env` ignored

**M1 — App shell and Learn stage layout (paused Oct 11 2026, not finished)**
- [x] Landing v1, Home/Resume, top bar + menu (landing polish deferred, below)
- [x] Learn stage layout: stage canvas, voice states, caption overlay, on-demand text panel, Library drawer
- [ ] Auth, session create/resume (deferred, below)
- [x] React Three Fiber scene: orbit, select, label, exploded view
- [x] Accessibility pass (contrast, keyboard, reduced motion); Prepared/Live badge
- [x] Check on a real low-end Android phone (Itel A667L, Android 14, Oct 11 2026)

**M2 — Engine: registry, solver, validator**
- [ ] Capability registry schema (validated JSON bundle in git; database sync deferred, below)
- [ ] Solver package + tests against worked examples
- [ ] Director-response schema + validator (no hard-coded engineering numbers, one question max)
- [ ] Per-turn flow over SSE plus a POST interrupt; stale-action invalidation
- [ ] Cost + token metering per session

**M3 — Professor (live AI)**
- [ ] Provider adapter (config-driven); postures (Answer/Learning/Build) and moves
- [ ] Prediction → test → reveal; teach-back; reading assignment
- [ ] 17 professor tests in CI; provider bake-off (~30 scenarios)

**M4 — Robotics Lab 1 (servo torque) end to end**
- [ ] Concept graph seed (~40 concepts, 3 labelled "lab")
- [ ] Servo + arm asset with named parts; load/torque sim (arm mass included)
- [ ] 1–2 analogies with "where it breaks down"
- [ ] 5 reading items with human-written guides; study planner v1 with editable table of contents
- [ ] Beginner journey works end to end

**M5 — Build Workbench v1 (parametric)**
- [ ] Workbench layout: parts/outliner, viewport, properties, guide/tests panel, checks strip, timeline/log
- [ ] `design.json` model with versions and undo/redo
- [ ] Curated parts catalog (datasheet-sourced, fidelity labelled), 6–10 parts
- [ ] Live solver checks (torque margin, mass); BOM; wiring outline; test plan; measurement log
- [ ] Learn ↔ Build handoff and side quests; Aili review mode with accept/reject suggestions
- [ ] Pan-tilt camera project template

**M6 — Labs 2–3 and library**
- [ ] Inside-the-servo/gearing lab; feedback-control lab
- [ ] Reference library UI, 30–40 verified items

**Deferred stage (after M6, before M7, and before any public deployment)** — decided Oct 11 2026. A real AI key may be used on Lucky's laptop only, never deployed and never on any hosting service, until this stage is done (Oct 12 2026).
- [ ] Sign-in (M1 slice 8)
- [ ] Saved sessions and migration (M1 slice 9)
- [ ] Landing page polish
- [ ] Waitlist
- [ ] Registry database sync (JSON in git → Postgres)

**M7 — Beta readiness**
- [ ] Waitlist, invite codes, consent + data-deletion wording (check Kenya data-protection requirements)
- [ ] Telemetry: predictions vs results, labs finished, out-of-coverage questions, ratings, cost per session
- [ ] Spend cap per user, error monitoring, backups
- [ ] Billing decision recorded (beta free with caps; no forced paywall)
- [ ] Frontier Lab: 5–10 verified cards (primary sources only)
- [ ] A plain notice that learner text is sent to the AI provider, and the data-region and consent decision (added Oct 12 2026)

**M8 — Beta run**
- [ ] 20–30 invited users; weekly check-ins; one-week transfer question; summary of what worked

**Later (not scheduled):** AR "view in AR" for Android, VR for Quest, free drag-and-snap assembly, power-budget solver, wiring simulation, voice provider upgrade.

## Accounts, apps and plugins
**Needed now:** Claude Pro ($20/mo) · GitHub · VS Code · Node.js LTS (22+) · Git · Supabase · Vercel or similar · a domain · email service (Resend or similar) · Sentry (free tier). Python 3.11+ only if a Python service is added.
**Needed by M3:** LLM provider API key (OpenAI and/or Anthropic API — separate from the Pro plan, billed per token; set a monthly spend limit first).
**Needed by M7:** analytics (PostHog or similar), waitlist table/tool; Paystack (Kenya; cards + M-PESA) only if/when you decide to charge.
**Claude Code add-ons (when needed):** GitHub integration, Playwright (browser tests), a Supabase MCP server against a **dev** project only.
**Not needed yet:** voice provider (browser speech first), 3D mesh generators, Stripe, vector DB, any XR tooling.

## Claude Code: installation
Requirements: a paid plan (free plan has no Claude Code), 4 GB RAM, Windows 10 1809+ / macOS 13+ / Ubuntu 20.04+. Kenya is on Anthropic's supported-countries list.
1. Subscribe to Pro at claude.ai.
2. Windows: install Git for Windows (git-scm.com).
3. Install: macOS/Linux/WSL `curl -fsSL https://claude.ai/install.sh | bash`; Windows PowerShell `irm https://claude.ai/install.ps1 | iex`; Windows CMD `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`. (Alternatives: `brew install --cask claude-code`, `winget install Anthropic.ClaudeCode`, `npm install -g @anthropic-ai/claude-code`.)
4. Reopen the terminal; `claude --version`. If not found, run `claude doctor`.
5. `cd` into the project and run `claude`; sign in via browser. Do NOT set `ANTHROPIC_API_KEY` on your machine, or it bills the API instead of your plan.
6. VS Code (1.94+): Extensions → search "Claude Code" (Anthropic) → Install → click the Claude icon → sign in. `claude update` forces an update.

## Working method
1. Branch, never `main`. Plan mode first (Shift+Tab), approve the plan.
2. One milestone item at a time, naming the docs it must read.
3. Run tests, commit small, review diffs.
4. Never paste secrets into chat; keys in `.env.local` / host settings.
5. `/clear` between unrelated tasks; `/status` for usage; `/model` to switch.
6. Keep `CLAUDE.md` current, including a never-do list: merge to main, destructive migrations, provisioning paid services, committing secrets.

## Which model on the $20 plan
- **Sonnet 5.5** (`/model sonnet`) for almost everything.
- Opus 5.5 only for hard design problems, if your picker offers it. Anthropic's docs and an older support article disagree on whether Pro includes Opus; run `/model` after signing in.
- Avoid Fable on Pro (can bill to usage credits).
- Pro gives roughly 10–40 Claude Code prompts per 5-hour window, shared with claude.ai chat, and Anthropic calls Pro suited to light work on small repos. Expect to hit it; keep prompts focused, no parallel instances, consider Max if blocked often.
- The app's own AI is a separate API bill (M3).
