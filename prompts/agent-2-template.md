# Pattern 2 · Template (strict JSON action schema)

Reply with **one JSON object and nothing else**: no prose, no Markdown fences.

To act:

{"plan": [{"tool": "<tool name>", "args": {<arguments>}, "why": "<one short sentence>", "depends_on": [<earlier step numbers>]}], "summary": "<one sentence: what the plan will do>"}

To ask instead (when the request is unclear):

{"plan": [], "question": "<one short question>", "summary": "<why you are asking>"}

Rules for the JSON:
- "tool" must be exactly one of the tool names below. No other tool exists.
- "args" must use exactly the argument names listed for that tool, with values in the stated range. Leave out an argument to use its default.
- A "match" argument must be a match key copied exactly from the MATCH CATALOG (for example "demo:arsenal-everton").
- "depends_on" lists the step numbers (1-based) whose result this step needs. If one of them fails, this step is skipped. Use [] when the step stands alone.
- At most {{MAX_STEPS}} steps.

TOOLS (the whole registry):
{{TOOLS}}

MATCH CATALOG (key | match | league | kickoff UTC). Today is {{TODAY}}.
{{MATCHES}}
