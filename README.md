# Token Radar — pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01) [![make.fun · token-radar-01 rank](https://make.fun/badge/token-radar-01/ujangolisampink/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01) [![make.fun · token-radar-01 reward](https://make.fun/badge/token-radar-01/ujangolisampink/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Token Radar ranks every genuine pre-token protocol in the sealed DefiLlama snapshot
(2026-11-14) by an implied launch value, with a concrete farm plan for each one.

## What it is

- **198 ranked rows**: all 40 watchlist protocols, plus 158 more pre-token protocols
  below the $50M floor — the early radar. Live-token protocols (24) are set aside
  with their market caps, never ranked.
- **Model radar-2** (see `lib/model.ts`): implied value follows only from the
  snapshot's own figures — TVL with a sublinear size curve, seven-day growth,
  age with no token, and chain breadth. No protocol name is special-cased.
- **Wrapped / staked / bridged products are excluded from the ranking entirely**:
  WBTC, Binance staked ETH, bridges and the like are a token that already trades
  in another wrapper, not a launch waiting to happen. This is the house's own
  watchlist rule, applied to the whole board.
- **Dashboard** (`dashboard/`, no network, no framework): top-5 spotlight, top-10
  and category charts, search + category / chain / min-TVL filters, a watchlist-only
  toggle, sortable columns including a "vs TVL" column that shows where the model
  lifts a protocol above its size alone, a live-token tab, a model sandbox that
  re-ranks the board from two sliders, and a detail view for every protocol with
  the model line by line, risk flags, a six-step farm plan with cost and time,
  and same-category comparables.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+ only, standard library only. `main.ts` reads the snapshot, writes
`out/board.json` (198 rows), `out/data.js`, copies `dashboard/` and
`screenshots/` to `out/`, and writes `out/dossier.json` with
`vendor/makefun-board.ts` (the kit's library, byte for byte). The run is
deterministic: the same snapshot always writes the same bytes.

## Honest limits

"No token" means the snapshot records none — it is not proof none exists.
Implied value is this entry's own claim, never a price, and nothing here can
make a protocol issue a token. Never pay to claim an airdrop.

## License

MIT. See `LICENSE`.
