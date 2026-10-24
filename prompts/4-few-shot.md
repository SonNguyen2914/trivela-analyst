# Pattern 4: Few-shot example

Example sheet (excerpt):
F1 | Leeds win probability | 44% | Trivela model
F2 | Draw probability | 27% | Trivela model
F3 | Fulham win probability | 29% | Trivela model
F4 | Leeds expected goals | 1.41 | Trivela model
F5 | Fulham expected goals | 1.12 | Trivela model
F12 | Market price for Leeds (cents, ask) | 52¢ | Kalshi order book

Example reply:
{"headline":"Leeds are slight favourites at {{F1}}, but this is closer than the market thinks.","why":["Trivela gives Leeds {{F1}} against {{F3}} for Fulham.","Leeds create more: {{F4}} expected goals to {{F5}}."],"risks":["A draw lands in {{F2}} of simulations, roughly one game in four."],"market_view":"The market asks {{F12}} for a Leeds win, a stronger lean than Trivela's {{F1}}.","confidence":"medium"}
