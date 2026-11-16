# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/slyph18/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/slyph18/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token launch radar: every protocol without a token in a sealed DeFiLlama snapshot gets an implied token value from a comps-fitted model — OLS of log10 market cap on log10 TVL across the snapshot's own launched tokens (128 comps), with shrunk per-category and per-age effects, validated leave-one-out (median calibration 0.86x) and surfaced in the dashboard methodology drawer. Top rows carry netted farm plans (expected value minus estimated transaction cost).

## Run it

```sh
node --experimental-strip-types main.ts --input snapshot.json
```

The CLI scores the snapshot, rebuilds `out/board.json` (200 rows), renders the static dashboard and stages the dossier.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x4s0c321&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
