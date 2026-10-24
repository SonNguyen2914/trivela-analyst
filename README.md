# Trivela Analyst

**An AI soccer analyst that explains match predictions in plain English, and proves every number it says.**

CS4680 Prompt Engineering · Assignment 3 (AI Assistant Project) · Nam Son Nguyen

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

- Move it into Trivela itself as a native panel on every match page.
- Live in-play commentary that re-reads the model each minute.
- A post-match "what the model got right and wrong" review.
