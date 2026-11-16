// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows a comps-fitted, log-linear model:
//
//   log10(mcap) = intercept + slope x log10(TVL) + category effect + age effect
//
// The launched protocols in the snapshot fit the line and the effects. No protocol name is ever
// special-cased: the same function scores every pre-token row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
  gas_context: GasContext | null;
}

/** How much an effect is pulled toward zero, as `count / (count + SHRINKAGE)`. */
export const EFFECT_SHRINKAGE = 5;
/** Slope bounds that keep the model a TVL comps model rather than an uncontrolled regression. */
export const TVL_SLOPE_MIN = 0.3;
export const TVL_SLOPE_MAX = 1.2;

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-1';

/** Optional snapshot context for farm-plan transaction costs. */
export interface GasContext {
  per_interaction_usd: number;
}

/** The comps-fitted, log-linear model. Effects are in log10 dollars. */
export interface CompsModel {
  version: 'comps-log10-ols-1';
  intercept_log10: number;
  tvl_slope: number;
  tvl_slope_clamped: boolean;
  category_effects: Record<string, number>;
  age_effects: Record<string, number>;
  shrinkage_counts: { category: Record<string, number>; age: Record<string, number> };
  band: { low_multiplier: number; mid_multiplier: number; high_multiplier: number };
  validation: ModelValidation;
}

/** Leave-one-out validation on the launched comps themselves. */
export interface ModelValidation {
  comp_count: number;
  median_absolute_error_pct: number;
  calibration_ratio: number;
}

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  confidence: number;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  category_multiplier: number;
  model: {
    intercept_log10: number;
    tvl_slope: number;
    tvl_effect_log10: number;
    category_effect_log10: number;
    age_effect_log10: number;
    category_multiplier: number;
    age_multiplier: number;
  };
  farm_steps: string[];
  farm_plan: FarmPlan | null;
}

/** A compact view of one row, with the sensitivity band the dashboard shows. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  confidence: number;
  implied_value_usd: number;
  band_low_usd: number;
  band_high_usd: number;
  category_multiplier: number;
  farm_plan_line: string | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: CompsModel;
  model_version: string;
  comps?: {
    intercept_log10: number;
    tvl_slope: number;
    comp_count: number;
    median_absolute_error_pct: number;
    calibration_ratio: number;
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The netted farm plan shown beside the thesis for the highest-ranked rows. */
export interface FarmPlan {
  gas_context: 'snapshot' | 'fallback';
  cost_per_interaction_usd: number;
  expected_interactions: number;
  expected_tx_cost_usd: number;
  expected_value_share_usd: number;
  net_usd: number;
  line: string;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/**
 * Confidence is evidence quality, not forecast strength. It is derived only from the snapshot:
 *
 *   tvlEvidence   = clamp(log10(max(tvl_usd, 1)) / log10(100,000,000), 0, 1)
 *   growthVariance = population variance of every finite change_7d value
 *   growthEvidence = 1 / (1 + growthVariance / 2,500) * (change_7d === null ? 0.6 : 1)
 *   ageEvidence    = age_days === null ? 0.15 : clamp(age_days / 1,095, 0, 1)
 *   confidence     = clamp(round(100 * (0.45 * tvlEvidence + 0.35 * growthEvidence + 0.20 * ageEvidence)), 0, 100)
 *
 * Variance is divided by 50², so a 50-point standard deviation yields half credit. Missing age is weak
 * rather than zero evidence; a missing row growth further discounts the growth component.
 */
const CONFIDENCE_TVL_CEILING = 100_000_000;
const CONFIDENCE_GROWTH_SCALE = 2_500;
const CONFIDENCE_MISSING_GROWTH_FACTOR = 0.6;
const CONFIDENCE_MISSING_AGE = 0.15;
const CONFIDENCE_AGE_DAYS = 1_095;

/** The population variance of the finite seven-day growth observations in the snapshot. */
export function growthVariance(protocols: SnapshotProtocol[]): number {
  const growth = protocols
    .map((p) => p.change_7d)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (growth.length === 0) return 0;
  const mean = growth.reduce((sum, value) => sum + value, 0) / growth.length;
  return growth.reduce((sum, value) => sum + (value - mean) ** 2, 0) / growth.length;
}

/** A 0..100 confidence score for one row, using the snapshot date and its growth variance. */
export function confidenceScore(protocol: SnapshotProtocol, asOf: string, variance: number): number {
  const tvlEvidence = Math.min(1, Math.max(0, Math.log10(Math.max(protocol.tvl_usd, 1)) / Math.log10(CONFIDENCE_TVL_CEILING)));
  const varianceEvidence = 1 / (1 + Math.max(variance, 0) / CONFIDENCE_GROWTH_SCALE);
  const growthEvidence = varianceEvidence * (protocol.change_7d === null ? CONFIDENCE_MISSING_GROWTH_FACTOR : 1);
  const ageEvidence = protocol.listed_at === null ? CONFIDENCE_MISSING_AGE : Math.min(1, Math.max(0, (ageDays(asOf, protocol.listed_at) ?? 0) / CONFIDENCE_AGE_DAYS));
  const score = 100 * (0.45 * tvlEvidence + 0.35 * growthEvidence + 0.2 * ageEvidence);
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const AGE_BUCKETS = ['<90d', '90-365d', '1-2y', '>2y', 'unknown'] as const;
type AgeBucket = (typeof AGE_BUCKETS)[number];

/** The listing-age bucket the comps model uses; a bad or absent date is its own bucket. */
function ageBucketFor(protocol: SnapshotProtocol, asOf: string): AgeBucket {
  const age = ageDays(asOf, protocol.listed_at);
  if (age === null) return 'unknown';
  if (age < 90) return '<90d';
  if (age <= 365) return '90-365d';
  if (age <= 730) return '1-2y';
  return '>2y';
}

/** An inclusive percentile from an already ascending list, using linear interpolation. */
function percentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * percentile;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low]!;
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

/** A shrunk mean of residuals for one categorical effect. */
function shrunkEffect(count: number, sum: number): number {
  return (sum / count) * (count / (count + EFFECT_SHRINKAGE));
}

type FittedCompsModel = Omit<CompsModel, 'validation'> & { residuals: number[] };

/** Fit the line and the two shrunk residual effects; validation is attached only at the public boundary. */
function fitComps(protocols: SnapshotProtocol[], asOf: string): FittedCompsModel {
  const comps = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  if (comps.length < 2) throw new SnapshotError('the snapshot needs at least two launched protocols with positive TVL and market cap');

  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd));
  const xMean = xs.reduce((sum, value) => sum + value, 0) / comps.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / comps.length;
  const cross = xs.reduce((sum, x, i) => sum + (x - xMean) * (ys[i]! - yMean), 0);
  const spread = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const rawSlope = spread === 0 ? 0 : cross / spread;
  const tvlSlope = Math.min(TVL_SLOPE_MAX, Math.max(TVL_SLOPE_MIN, rawSlope));
  const intercept = yMean - tvlSlope * xMean;

  const categoryCounts = new Map<string, number>();
  const categorySums = new Map<string, number>();
  comps.forEach((p, i) => {
    const key = p.category ?? 'unknown';
    const residual = ys[i]! - (intercept + tvlSlope * xs[i]!);
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
    categorySums.set(key, (categorySums.get(key) ?? 0) + residual);
  });
  const categoryEffects: Record<string, number> = {};
  const categoryShrinkage: Record<string, number> = {};
  for (const [key, count] of categoryCounts) {
    categoryEffects[key] = shrunkEffect(count, categorySums.get(key)!);
    categoryShrinkage[key] = count;
  }

  const ageCounts = new Map<string, number>();
  const ageSums = new Map<string, number>();
  comps.forEach((p, i) => {
    const key = ageBucketFor(p, asOf);
    const prediction = intercept + tvlSlope * xs[i]! + (categoryEffects[p.category ?? 'unknown'] ?? 0);
    const residual = ys[i]! - prediction;
    ageCounts.set(key, (ageCounts.get(key) ?? 0) + 1);
    ageSums.set(key, (ageSums.get(key) ?? 0) + residual);
  });
  const ageEffects: Record<string, number> = {};
  const ageShrinkage: Record<string, number> = {};
  for (const [key, count] of ageCounts) {
    ageEffects[key] = shrunkEffect(count, ageSums.get(key)!);
    ageShrinkage[key] = count;
  }

  const residuals = comps.map((p, i) => {
    const prediction = intercept + tvlSlope * xs[i]! +
      (categoryEffects[p.category ?? 'unknown'] ?? 0) +
      (ageEffects[ageBucketFor(p, asOf)] ?? 0);
    return ys[i]! - prediction;
  }).sort((a, b) => a - b);

  return {
    version: 'comps-log10-ols-1',
    intercept_log10: intercept,
    tvl_slope: tvlSlope,
    tvl_slope_clamped: tvlSlope !== rawSlope,
    category_effects: categoryEffects,
    age_effects: ageEffects,
    shrinkage_counts: { category: categoryShrinkage, age: ageShrinkage },
    band: {
      low_multiplier: Math.max(0, 10 ** percentile(residuals, 0.25)),
      mid_multiplier: Math.max(0, 10 ** percentile(residuals, 0.5)),
      high_multiplier: Math.max(0, 10 ** percentile(residuals, 0.75)),
    },
    residuals,
  };
}

/** Fit a comps model from the launched protocols in one snapshot. */
export function fitCompsModel(protocols: SnapshotProtocol[], asOf: string = new Date().toISOString().slice(0, 10)): CompsModel {
  const fitted = fitComps(protocols, asOf);
  const errors: number[] = [];
  const calibration: number[] = [];
  for (const heldOut of protocols) {
    if (heldOut.mcap_usd === null || heldOut.mcap_usd <= 0 || heldOut.tvl_usd <= 0) continue;
    const training = protocols.filter((p) => p.slug !== heldOut.slug);
    const model = fitComps(training, asOf);
    const prediction = impliedValue(heldOut, asOf, model).implied;
 errors.push(Math.abs(prediction - heldOut.mcap_usd) / heldOut.mcap_usd * 100);
 calibration.push(prediction / heldOut.mcap_usd);
 }
 // Report the median prediction/actual as the calibration ratio: the mean is dominated by a few
 // large-cap comps where log-linear errors are inherently skewed, and the median is the honest
 // "typical" out-of-sample calibration figure.
 const sortedRatios = [...calibration].sort((a, b) => a - b);
 return {
 ...fitted,
 validation: {
   comp_count: errors.length,
   median_absolute_error_pct: errors.length === 0 ? 0 : percentile(errors, 0.5),
   calibration_ratio: sortedRatios.length === 0 ? 0 : sortedRatios[Math.floor(sortedRatios.length / 2)],
 },
 };
 }

/** The fitted values for one protocol: the linear part, the multipliers and the implied value. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: Omit<CompsModel, 'validation'> | CompsModel): { implied: number; tvlEffect: number; categoryEffect: number; ageEffect: number; categoryMult: number; ageMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const bucket = ageBucketFor(protocol, asOf);
  const categoryEffect = protocol.category === null ? 0 : (model.category_effects[protocol.category] ?? 0);
  const ageEffect = model.age_effects[bucket] ?? 0;
  const tvlEffect = protocol.tvl_usd > 0 ? model.tvl_slope * Math.log10(protocol.tvl_usd) : 0;
  const linear = model.intercept_log10 + tvlEffect + categoryEffect + ageEffect;
  const categoryMult = 10 ** categoryEffect;
  const ageMult = 10 ** ageEffect;
  const implied = protocol.tvl_usd > 0 && Number.isFinite(linear)
    ? Math.max(1, Math.round(10 ** linear))
    : 1;
  return { implied, tvlEffect, categoryEffect, ageEffect, categoryMult, ageMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model?: ModelConstants): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const variance = growthVariance(snapshot.protocols);
  const compsModel = fitCompsModel(snapshot.protocols, snapshot.as_of);
  const scored = [...chosen.values()].map((p) => {
    const { implied, tvlEffect, categoryEffect, ageEffect, categoryMult, ageMult, age } = impliedValue(p, snapshot.as_of, compsModel);
    return { p, implied, tvlEffect, categoryEffect, ageEffect, categoryMult, ageMult, age, confidence: confidenceScore(p, snapshot.as_of, variance) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    confidence: s.confidence,
    implied_value_usd: s.implied,
    band_low_usd: Math.max(1, Math.round(s.implied * compsModel.band.low_multiplier)),
    band_high_usd: Math.max(s.implied, Math.round(s.implied * compsModel.band.high_multiplier)),
    category_multiplier: s.categoryMult,
    model: {
      intercept_log10: round4(compsModel.intercept_log10),
      tvl_slope: compsModel.tvl_slope,
      tvl_effect_log10: round4(s.tvlEffect),
      category_effect_log10: round4(s.categoryEffect),
      age_effect_log10: round4(s.ageEffect),
      category_multiplier: round4(s.categoryMult),
      age_multiplier: round4(s.ageMult),
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    farm_plan: i < FARM_PLAN_ROWS ? farmPlan(s.implied, s.p, (snapshot as any).gas_context ?? null) : null,
  }));
}

/** How many top-ranked rows carry the netted transaction-cost thesis. */
export const FARM_PLAN_ROWS = 20;

/** The netted farm thesis for one top-ranked row. */
function farmPlan(implied: number, protocol: SnapshotProtocol, gasContext: GasContext | null): FarmPlan {
  const source = gasContext !== null && Number.isFinite(gasContext.per_interaction_usd) && gasContext.per_interaction_usd >= 0
    ? 'snapshot'
    : 'fallback';
  const costPerInteraction = source === 'snapshot'
    ? gasContext!.per_interaction_usd
    : 1.5;
  const interactions = Math.max(1, protocol.chains.length);
  const cost = costPerInteraction * interactions;
  const net = implied - cost;
  const line = `${interactions} estimated interaction${interactions === 1 ? '' : 's'} on ${protocol.chains.length || 1} chain${protocol.chains.length === 1 ? '' : 's'}: ` +
    `about $${cost.toFixed(2)} total gas, $${fmtNet(net)} net implied value`;
  return {
    gas_context: source,
    cost_per_interaction_usd: costPerInteraction,
    expected_interactions: interactions,
    expected_tx_cost_usd: cost,
    expected_value_share_usd: implied,
    net_usd: net,
    line,
  };
}

/** Farm-plan net, rounded to cents and signed only when negative. */
function fmtNet(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded < 0 ? `-${Math.abs(rounded).toFixed(2)}` : rounded.toFixed(2);
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    confidence: row.confidence,
    implied_value_usd: row.implied_value_usd,
    band_low_usd: row.band_low_usd,
    band_high_usd: row.band_high_usd,
    category_multiplier: row.category_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model?: ModelConstants): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const compsModel = fitCompsModel(snapshot.protocols, snapshot.as_of);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    comps: {
      intercept_log10: compsModel.intercept_log10,
      tvl_slope: compsModel.tvl_slope,
      comp_count: compsModel.validation.comp_count,
      median_absolute_error_pct: compsModel.validation.median_absolute_error_pct,
      calibration_ratio: compsModel.validation.calibration_ratio,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
