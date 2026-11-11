# Trivela Analyst

**An AI soccer analyst that explains match predictions in plain English, and proves every number it says.**

CS4680 Prompt Engineering · Assignment 3 (AI Assistant Project) · Nam Son Nguyen

> **Status: refinement stage.** Trivela Analyst is built for [namson.dev](https://namson.dev/bet-suggester), my live soccer prediction site, and runs on its real model data. It goes live on namson.dev on **October 25, 2026**.

## The problem

[Trivela](https://namson.dev/bet-suggester) is my soccer prediction system. Its models simulate each match 10,000 times and produce win, draw and loss probabilities, expected goals, scorelines and team strength ratings. It also tracks the prediction market's prices. That is a wall of numbers that most fans can't read.

An LLM could explain them, but LLMs make numbers up. An analyst that says "Arsenal win 73% of the time" when the model says 51% is worse than no analyst. **Trivela Analyst turns the model's numbers into a short, readable preview and a Q&A box, and it cannot state a number that isn't in Trivela's data.**

## What it does

- **Analyst preview card.** For any upcoming Premier League, La Liga, MLS or Liga MX match:
  - a headline;
  - why the model leans the way it does;
  - the risks;
  - how the model compares with the market;
  - the analyst's confidence.
- **Ask Trivela.** Ask anything about the match ("How likely is a draw?", "Does the market agree?"). Answers are grounded only in the match's fact sheet.
- **Verified numbers.** Every number on screen is green with a ✓. Hover it to see the exact fact it came from (for example, "Arsenal win probability · Trivela model, 10,000 simulations"). Anything the verifier cannot trace is replaced with a red `[unverified]` flag.
- **How it works panel.** Shows the live fact sheet, the exact system prompt, each attempt's raw model output, and what the verifier caught.
- **Demo mode.** Three saved match snapshots, so the demo never depends on a live fixture.
- **Fallback.** If the LLM is down or over budget, the card shows Trivela's raw numbers instead of going blank.

## How it works

```
Trivela public API ─► Fact sheet (every number gets an id: F1, F2 …)
                           │
                           ▼
   system prompt = Persona + Verification ladder + JSON template + few-shot + fact sheet
                           │
                           ▼
                 LLM (Claude or Gemini)
                           │
                           ▼
      Verifier: every number must be a {{F#}} placeholder or match a fact
          │ fails                                  │ passes
          ▼                                        ▼
   one retry, listing the violations ──► render with ✓ badges
          │ still fails
          ▼
   strip the number, show [unverified]
```

## Trivela Analyst — prompt engineering

| # | Pattern | Where in the code | Why |
|---|---|---|---|
| 1 | **Persona** | [`prompts/1-persona.md`](prompts/1-persona.md) | A sharp, plain-spoken analyst explaining probabilities to fans. It sets tone, reading level, and hard rules: never betting advice, always point out model/market disagreement. |
| 2 | **Verification ladder** (my own pattern from Assignment 2) | [`prompts/2-verification-ladder.md`](prompts/2-verification-ladder.md) plus the server-side check in [`lib/verify.ts`](lib/verify.ts) | Answer, then confidence, then check every number against Source A (the fact sheet, which always wins), then flag anything untraceable instead of stating it. The model writes numbers only as `{{F#}}` ids, so a correct number is correct by construction, and the server checks the rest. |
| 3 | **Template** (strict JSON) | [`prompts/3-template.md`](prompts/3-template.md), parsed in [`lib/analyst.ts`](lib/analyst.ts) | A fixed shape (`headline`, `why[]`, `risks[]`, `market_view`, `confidence`) the UI can render reliably and the verifier can check field by field. |
| 4 | **Few-shot** | [`prompts/4-few-shot.md`](prompts/4-few-shot.md) | One worked example showing placeholders, tone and length, which cuts format errors. |
| 5 | **Iterative refinement** | `runPreview` / `runAsk` in [`lib/analyst.ts`](lib/analyst.ts) | When verification fails, the exact violations are sent back to the model for one rewrite. |

The assembled system prompt is visible in the app under **How the Analyst works**.

## Trivela Agent (Assignment 4: AI Agent Project)

**Trivela Agent turns a plain-English request into actions.** The language model writes a plan, the person sees every step, and Trivela's own code checks the plan and runs it. The model never runs anything itself. Open it at `/agent`, or `/agent?demo=1` for the saved demo matches.

Example requests:

- "Compare model vs market for every match"
- "Track Arsenal vs Everton if the gap is over 5%"
- "Export a report for Rayo vs Elche as CSV"
- "I think Arsenal win, log it with high confidence, then show my journal"
- "Clear my prediction journal" (a destructive step: it needs a Confirm click)
- "Delete it" (unclear: the agent asks a question instead of acting)

### Architecture

```
 person ─► /agent page ─► POST /api/agent/plan
                              │  rate limit (10 a minute per IP) + daily LLM cap
                              ▼
        system prompt = persona + JSON template (tool registry + match catalog injected)
                        + few-shot + verification ladder
                              │
                              ▼
                 LLM (Claude or Gemini, retries on 429/5xx)
                              │  strict JSON: {"plan":[{tool,args,why,depends_on}],"summary"}
                              ▼
     validator: tool in registry? args match schema and range? match key in catalog?
          │ fails                                         │ passes
          ▼                                               ▼
  errors sent back once ─► still fails:          plan stored, shown as step cards
  clear error, nothing runs                       (nothing has run yet)
                                                          │ person clicks Run
                                                          ▼
                                     POST /api/agent/execute, one step at a time
                                     · steps run in order; a failed step skips the
                                       steps that depend on it
                                     · destructive step: refused without a single-use
                                       token from POST /api/agent/confirm
                                                          │
                                  ┌───────────────┬───────┴──────┬────────────────┐
                                  ▼               ▼              ▼                ▼
                          Trivela public API   SQLite tables   exports/ folder   capped simulation
                          (read-only)                                             (read-only)
                                  └──────── every outcome ─► audit_log (append-only)
```

### Tools (the whole registry)

| Domain | Tool | What it does |
|---|---|---|
| API calls | `list_matches` | The matches the agent may act on (upcoming Trivela fixtures plus saved demo matches). |
| API calls | `get_prediction(match)` | Trivela's win/draw/loss probabilities, expected goals and likeliest scores. |
| API calls | `get_market_prices(match)` | The prediction market's 3-way prices. |
| API calls | `compare_model_vs_market(match)` | Model vs market per outcome, overround removed, gap in points. |
| Database | `add_to_watchlist(match, threshold_pts)` | Track a match; flagged when the gap is over the threshold. |
| Database | `list_watchlist()` | The watchlist with each match's current gap and status. |
| Database | `remove_from_watchlist(id)` **destructive** | Remove one entry; needs confirmation. |
| Database | `log_pick(match, outcome, confidence)` | Record your own prediction next to the model's probability. |
| Database | `list_picks()` | Your prediction journal. |
| Database | `clear_picks()` **destructive** | Empty the journal; needs confirmation. |
| Files | `export_report(match, format=md\|csv)` | Writes a report to the sandboxed `exports/` folder and returns a download link. |
| System | `run_simulation(match, n_sims)` | A Monte Carlo re-run (Poisson) from the model's own expected goals, `n_sims` capped at 1,000–50,000. Read-only. |

Tables: `plans`, `step_runs`, `watchlist`, `picks`, `exports`, `confirm_tokens`, `audit_log` ([`lib/agent/store.ts`](lib/agent/store.ts)).

### Safety design

- **No code from the model.** The model returns JSON only. The registry ([`lib/agent/tools.ts`](lib/agent/tools.ts)) is the only thing that can run: no `eval`, no shell, no free-form paths.
- **Validate everything first** ([`lib/agent/validator.ts`](lib/agent/validator.ts)). Each step's tool must exist and its arguments must match the schema, the range and the live match catalog. A plan with one bad step is rejected whole, so a partial plan never runs. The errors go back to the model for one rewrite; if that fails too, the person sees a clear error.
- **Confirm destructive steps** ([`lib/agent/executor.ts`](lib/agent/executor.ts)). The server refuses `remove_from_watchlist` and `clear_picks` without a single-use token. The token is bound to one session, one plan and one step, and expires after 5 minutes. It is only issued when the person clicks Confirm.
- **Failures stop what depends on them.** Each step lists `depends_on`. A failed step skips those steps and says which step failed; independent steps still run.
- **Audit log** ([`lib/agent/audit.ts`](lib/agent/audit.ts)). Every plan, confirmation, run, refusal and skip is written with its time, session, request, tool, arguments, status and error. Database triggers refuse any UPDATE or DELETE on the log. The page shows the session's log.
- **Public-demo guards.** 10 plans a minute per IP, a daily LLM call cap, at most 6 steps a plan, per-session caps on watchlist, picks and exports, and LLM retries with exponential backoff and clear error messages. Data is scoped to an anonymous session cookie, so visitors cannot see or change each other's data. Exports are served only to the session that made them, and only from `exports/`.
- **Read-only on Trivela.** The agent only reads Trivela's public API. It never changes the prediction model.

### Prompt engineering (4 patterns)

| # | Pattern | File | What it does |
|---|---|---|---|
| 1 | **Persona** | [`prompts/agent-1-persona.md`](prompts/agent-1-persona.md) | A careful operations agent: plans first, never guesses match ids, asks when unclear, does the least that answers the request, no betting advice. |
| 2 | **Template** | [`prompts/agent-2-template.md`](prompts/agent-2-template.md) | The strict JSON action schema, with the tool registry and match catalog injected at run time ([`lib/agent/planner.ts`](lib/agent/planner.ts)). |
| 3 | **Few-shot** | [`prompts/agent-3-few-shot.md`](prompts/agent-3-few-shot.md) | Three requests and their correct plans, including one that asks a clarifying question instead of acting. |
| 4 | **Verification ladder** (my Assignment 2 pattern) | [`prompts/agent-4-verification.md`](prompts/agent-4-verification.md) + the validator | Answer, confidence, check against Source A (the registry and the live catalog), flag instead of inventing. The server runs the same check, and untraceable steps are never executed. |

The assembled prompt and every attempt's raw output are visible on the page under **How the agent planned this**.

### Run and test

`npm run dev`, then open http://localhost:3100/agent. Without an API key the agent uses a small rule-based planner, so the page and every safety check still work. `npm test` runs the agent tests (validator, planner retry, LLM backoff, executor, confirmation gate, audit log, export sandbox, rate limit) with a mocked LLM and no network. Node 22.13 or newer is needed for the built-in SQLite. Optional settings: `AGENT_DB`, `AGENT_EXPORTS`, `AGENT_PLANS_PER_MIN`.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3100. Put your key in `.env.local` (never commit it):

- `LLM_PROVIDER=claude` with `ANTHROPIC_API_KEY`, or `LLM_PROVIDER=gemini` with `GEMINI_API_KEY`.
- With no key, it runs a mock model so the UI and verifier still work.

Run the tests with `npm test`. They cover the fact sheet, the verifier (rounding, invented numbers, unknown ids), the retry and flag loop, and the fallback. No network is used.

## Design notes and limits

- **Read-only on Trivela.** The app only calls Trivela's public read routes (`/api/{league}/match/{id}`, `/api/{league}/schedule`). It never changes the prediction models.
- **Spend guard.** Previews are cached for 15 minutes per match, so one LLM call serves every visitor. Ask is limited per IP per hour, and there is a daily call cap (`ASK_PER_IP_PER_HOUR`, `LLM_DAILY_CALLS`).
- **Known limit.** A bare small integer (like "3") is accepted if any count fact has that value, so the verifier can be fooled by a coincidental match. The prompt forbids raw digits, so this rarely triggers. A stricter version would require placeholders for every number.
- **Not betting advice.** The persona forbids it, and the market is described as "what the market thinks".

## Future work

- **Oct 25, 2026:** launch on namson.dev (analyst.namson.dev, linked from every match page).
- A native Analyst panel on every namson.dev match page.
- Live in-play commentary that re-reads the model each minute.
- A post-match "what the model got right and wrong" review.
