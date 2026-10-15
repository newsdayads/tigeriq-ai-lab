/**
 * GH-2293 R10: offline, deterministic, hypothetical unit-economics model.
 * This is NOT authenticated Apify usage, billing, commercial demand or payout evidence.
 * Source: https://docs.apify.com/actors/publishing/monetize/pricing-and-costs
 * Non-standby, PPE-only, paying-plan scenarios; other platform costs are EXPLICIT
 * assumptions rather than an implicit zero. No network, secrets or side effects.
 */

export const R10_ECONOMICS_SCOPE = 'SCENARIO_ONLY_NOT_ACTUAL_APIFY_USAGE';
export const APIFY_PPE_COMPUTE_RATE_USD = Object.freeze({
  BRONZE: '0.20', SILVER: '0.16', GOLD: '0.13',
});
const SCALE = 10n ** 12n;
const MAX_INPUT = /^\d{1,12}(?:\.\d{1,9})?$/;

function decimal(name, value) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !MAX_INPUT.test(String(value))) {
    throw new TypeError(`${name}_MUST_BE_NONNEGATIVE_DECIMAL_UP_TO_9_PLACES`);
  }
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, '0') || '0');
}
function divideRounded(n, d) {
  if (d <= 0n) throw new RangeError('DIVISOR_MUST_BE_POSITIVE');
  const sign = n < 0n ? -1n : 1n;
  const value = n < 0n ? -n : n;
  return sign * ((value + d / 2n) / d);
}
function toFixed(value, places = 9) {
  const unit = 10n ** BigInt(12 - places);
  const rounded = divideRounded(value, unit);
  const absolute = rounded < 0n ? -rounded : rounded;
  const base = 10n ** BigInt(places);
  const prefix = rounded < 0n && absolute !== 0n ? '-' : '';
  return `${prefix}${absolute / base}.${(absolute % base).toString().padStart(places, '0')}`;
}
function safeRatio(numerator, denominator) {
  if (denominator === 0n) return null;
  return toFixed(divideRounded(numerator * SCALE, denominator), 6);
}

/**
 * @param {object} scenario Explicit assumptions, never a real Apify invoice.
 * @param {'PPE_ONLY'} scenario.pricingModel Unsupported modes fail closed.
 * @param {boolean} scenario.actorUsesStandbyMode Must explicitly be false.
 * @param {'FREE'|'BRONZE'|'SILVER'|'GOLD'} scenario.customerTier
 * @param {string|number} scenario.eventPriceUsd Price for ONE event at this tier.
 * @param {string|number} scenario.computeUnits Hypothetical CU consumed per event.
 * @param {string|number} scenario.nonCuPlatformCostUsd Hypothetical non-CU costs;
 *   zero must be explicitly supplied, never silently assumed.
 */
export function computePpeScenario({
  pricingModel, actorUsesStandbyMode, customerTier, eventPriceUsd,
  computeUnits, nonCuPlatformCostUsd,
} = {}) {
  if (pricingModel !== 'PPE_ONLY') throw new RangeError('UNSUPPORTED_PRICING_MODEL');
  if (actorUsesStandbyMode !== false) throw new RangeError('STANDBY_MODE_UNSUPPORTED_OR_UNVERIFIED');
  if (!['FREE', ...Object.keys(APIFY_PPE_COMPUTE_RATE_USD)].includes(customerTier)) {
    throw new RangeError('UNKNOWN_CUSTOMER_TIER');
  }
  const price = decimal('eventPriceUsd', eventPriceUsd);
  const cu = decimal('computeUnits', computeUnits);
  const nonCuCost = decimal('nonCuPlatformCostUsd', nonCuPlatformCostUsd);
  const tierIsPaid = customerTier !== 'FREE';
  // Per Apify's PPE pricing documentation, free-plan usage contributes neither
  // developer proceeds nor attributable platform costs to PPE profit.
  const rate = tierIsPaid ? decimal('rate', APIFY_PPE_COMPUTE_RATE_USD[customerTier]) : 0n;
  const proceeds = tierIsPaid ? divideRounded(price * 8n, 10n) : 0n;
  const cuCost = tierIsPaid ? divideRounded(cu * rate, SCALE) : 0n;
  const platformCost = tierIsPaid ? cuCost + nonCuCost : 0n;
  const profit = proceeds - platformCost;
  const breakEvenBudget = proceeds - (tierIsPaid ? nonCuCost : 0n);
  const margin30Budget = divideRounded(proceeds * 7n, 10n) - (tierIsPaid ? nonCuCost : 0n);
  // A displayed maximum must never round UP beyond the safe CU budget.
  // Keep 9-decimal public output; floor both integer division stages.
  const capacity = budget => {
    if (!tierIsPaid || budget < 0n) return null;
    const capacityPicoCu = budget * SCALE / rate;
    const nanoCu = capacityPicoCu / 1000n;
    const billion = 1000000000n;
    return `${nanoCu / billion}.${(nanoCu % billion).toString().padStart(9, '0')}`;
  };
  return Object.freeze({
    evidenceStatus: R10_ECONOMICS_SCOPE,
    pricingModel, actorUsesStandbyMode, customerTier,
    payingUser: tierIsPaid,
    eventPriceUsd: toFixed(price),
    computeUnitsAssumed: toFixed(cu),
    nonCuPlatformCostUsdAssumed: toFixed(nonCuCost),
    platformCuRateUsd: tierIsPaid ? APIFY_PPE_COMPUTE_RATE_USD[customerTier] : null,
    developerShareUsd: toFixed(proceeds),
    computeCostUsdAssumed: toFixed(cuCost),
    totalPlatformCostUsdAssumed: toFixed(platformCost),
    profitUsdAssumed: toFixed(profit),
    profitMarginOnDeveloperShare: safeRatio(profit, proceeds),
    breakEvenComputeUnitsAtAssumedNonCuCost: capacity(breakEvenBudget),
    // A 30% margin is undefined with no developer proceeds, even at zero CU.
    maxComputeUnitsFor30PctDeveloperMargin: proceeds === 0n ? null : capacity(margin30Budget),
    verifiedActualApifyUsage: false,
    verifiedActualPaidRevenue: false,
    commercialDecisionReady: false,
  });
}
