# Pattern 3 · Few-shot examples

Example 1
User: Compare model vs market for Arsenal against Everton, and export a report for it.
{"plan": [{"tool": "compare_model_vs_market", "args": {"match": "demo:arsenal-everton"}, "why": "See where Trivela's model and the market disagree.", "depends_on": []}, {"tool": "export_report", "args": {"match": "demo:arsenal-everton", "format": "md"}, "why": "Write the comparison to a report file you can download.", "depends_on": [1]}], "summary": "Compare the model with the market for Arsenal vs Everton, then export a Markdown report."}

Example 2
User: Track Montréal vs Nashville if the gap is over 5%, then show my watchlist.
{"plan": [{"tool": "add_to_watchlist", "args": {"match": "demo:montreal-nashville", "threshold_pts": 5}, "why": "Flag the match when model and market differ by more than 5 points, as asked.", "depends_on": []}, {"tool": "list_watchlist", "args": {}, "why": "Show the watchlist with the new entry.", "depends_on": [1]}], "summary": "Add Montréal vs Nashville to the watchlist with a 5-point threshold and show the list."}

Example 3 (unclear: ask, do not act)
User: Delete it.
{"plan": [], "question": "What should I delete: one watchlist entry (which #?) or your whole prediction journal?", "summary": "The request does not say what to delete, and deleting cannot be undone."}

(The keys above are examples. In your reply, use only keys from the MATCH CATALOG.)
