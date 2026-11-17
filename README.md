# DIPLINE — Race a BTC trading bot live for 24 hours

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/Djebrix/btc-race/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/Djebrix/btc-race/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

A mean-reversion trading bot for make.fun's [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261117-0603) ($250, 10 places). It trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, on paper money — no real money is traded.

## Strategy

The 1-minute cbBTC bars are quiet (per-bar return std ~6.4 bps) and range-bound, while a full-size round trip costs ~37 bps, so trend rules lose to the cost on the dev window (EMA cross -106, Donchian breakout -24, ADX momentum -33). DIPLINE buys genuine dips instead: when the close is at least 80 bps below its 1-hour average (SMA 60) and the 4-hour return is no worse than -200 bps, it buys with the full cash; it sells the whole position at +150 bps over cost (take-profit) or -100 bps under it (stop-loss). Few trades, each one larger than the round-trip cost.

Dev window (grade-local): net PnL **+$28.99**, 4 trades (2 round trips), max drawdown 0.76%, deterministic.

## Run

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout (see `protocol.schema.json` in the kit). Node 22, stdlib only. `vendor/makefun-bars.ts` is the kit's SDK shim, copied byte-for-byte.
