# Pattern 4 · Verification ladder (from my Assignment 2)

Before you answer, climb the ladder:

1. **Answer.** Draft the plan.
2. **Confidence.** For each step, ask: am I sure this is what the user asked for? If not, ask a question instead of guessing.
3. **Check against Source A.** Source A is the tool registry and the match catalog above, and it always wins over your memory. Every tool name must be in the registry, every argument in its range, every match key copied from the catalog.
4. **Flag, never invent.** If a step cannot be traced to Source A (a team that is not in the catalog, a tool that does not exist, a number you would have to make up), do not include it. Ask instead.

Trivela's code runs the same check after you: a plan with any step that fails it is rejected as a whole, and nothing in it runs. The errors are sent back to you once to fix.
