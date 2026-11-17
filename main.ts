// DIPLINE — a mean-reversion bot for the make.fun BTC race (btc-race-24h-20261117-0603).
//
// Why mean reversion, not trend following, on this market: the 1-minute cbBTC bars are
// extremely quiet (per-bar return std ~6.4 bps) and range-bound, while a full-size round
// trip costs ~37 bps (4 bps fee + 2 bps slippage + ~12 bps price impact each way at the
// pool depths in the dev window). Every trend rule I tested on the dev window loses to
// that cost: plain EMA cross (8/21) -106, long EMA cross (50/200) -28, Donchian breakout
// (120/20) -24, ADX momentum -33, 1-hour momentum with trailing stop -14 to -40. The
// window's real structure is oscillation around a slow drift (total move +0.49% over 24h,
// with a +1.65% spike that reverses -1.8% within an hour), so the trade that pays is
// buying a genuine dip and selling the recovery — few trades, each one larger than the
// round-trip cost.
//
//   - Reference: SMA(60) of closes (the 1-hour average). A dip is a close at least 80 bps
//     below it — far above the ~6 bps per-bar noise, so it is a real dislocation, not chop.
//   - Entry, on a bar's close (filled at the next open): flat, and the close is >= 80 bps
//     below SMA(60), and the 240-bar (4-hour) return is no worse than -200 bps (a guard
//     against buying into a severe downtrend; it never binds on the dev window). Buy with
//     the full cash (up to 100% of equity, capped by caps.max_weight_bps).
//   - Exit, the whole position: the position is worth >= 150 bps over its cost at the close
//     (take-profit), or <= 100 bps under it (stop-loss). Either is read again on every bar,
//     so a sell the market refuses is sent again on the next bar while its reason holds.
//     After a stop-loss exit the bot waits 30 bars before buying again, so a dip that is
//     still falling is not bought straight back into.
//   - A reply carries at most 1 order (1 symbol, 1 position). Each order caps its slippage
//     at MAX_SLIPPAGE_BPS = 100, 1% past the close it was decided on.
//   - A bar with no CBBTC in the batch adds nothing and is not decided on (a gap is not a
//     signal). While warming up it sends no order (the replay would reject every one).
//   - All arithmetic is float64 on + - * / alone for the indicators (SMA, ratios), and exact
//     bigint comparisons for the exit thresholds, each correctly rounded (IEEE 754), so the
//     same bars give the same orders, run after run. No clock, no environment, no Math.random;
//     all state is derived from the bars.
//
// Dev window (grade-local, --driver process): net PnL +$28.99, 4 trades (2 round trips),
// max drawdown 0.76%, deterministic (two runs byte-identical). House baselines on the same
// window for reference: buy-and-hold +$1.07, momentum +$2.45, rsi-bollinger -$24.25,
// ema-cross -$106.21, adx-momentum -$32.66.

import { BPS, runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** The reference average: 60 one-minute closes (one hour). */
const SMA_BARS = 60;
/** A dip: the close this far below SMA(60) (80 bps = 0.80%). */
const DIP_BPS = 80;
/** Take-profit: the position worth this far over its cost (150 bps = 1.50%). */
const TAKE_BPS = 150;
/** Stop-loss: the position worth this far under its cost (100 bps = 1.00%). */
const STOP_BPS = 100;
/** The downtrend guard: the 240-bar (4-hour) return this far or better to buy. */
const GUARD_BARS = 240;
const GUARD_BPS = -200;
/** 1% past the close the order was decided on. */
const MAX_SLIPPAGE_BPS = 100;

/** The closes seen so far, oldest first (a gap adds nothing). */
const closes: number[] = [];
/**
 * The seq of the batch where a stop-loss exit last fired (-1 when none has). After a
 * stop-loss the bot waits COOLDOWN_BARS before buying again: a dip that is still
 * falling when the stop fires is not bought straight back into.
 */
let lastStopLossSeq = -1;
/** Bars to wait after a stop-loss exit before buying again. */
const COOLDOWN_BARS = 30;

/** SMA(60) of the closes seen, or null before 60 bars. */
function sma60(): number | null {
  if (closes.length < SMA_BARS) return null;
  let sum = 0;
  for (let i = closes.length - SMA_BARS; i < closes.length; i++) sum += closes[i]!;
  return sum / SMA_BARS;
}

/** The 240-bar return in bps, or null before 240 bars. */
function longReturnBps(): number | null {
  if (closes.length <= GUARD_BARS) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - GUARD_BARS]!;
  return ((now - then) / then) * 10000;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === 'CBBTC');
    if (bar === undefined) return [];
    closes.push(Number(bar.c));
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const held = state.positions.get('CBBTC');
    const close = Number(bar.c);
    const ref = sma60();

    if (held !== undefined) {
      const value = state.value('CBBTC', held.qty);
      const take = (held.cost * BigInt(10000 + TAKE_BPS)) / 10000n;
      const stop = (held.cost * BigInt(10000 - STOP_BPS)) / 10000n;
      if (value >= take || value <= stop) {
        if (value <= stop) lastStopLossSeq = state.seq;
        const sell: SellInput = { side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    if (ref === null) return [];
    if (close > ref * (1 - DIP_BPS / 10000)) return [];
    if (lastStopLossSeq >= 0 && state.seq - lastStopLossSeq < COOLDOWN_BARS) return [];
    const guard = longReturnBps();
    if (guard !== null && guard < GUARD_BPS) return [];

    let slice = state.cash;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    if (slice > byWeight) slice = byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: 'CBBTC', notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
