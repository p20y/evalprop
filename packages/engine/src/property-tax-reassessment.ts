/**
 * Property tax defaults for states that reassess to the purchase price when a property is sold.
 *
 * Why this matters: the seller's current tax bill says little about what a new owner will pay in these
 * states, so when the user supplies no property tax the engine defaults to `ratePct` x PURCHASE PRICE
 * (and says why in the assumption note). All other states keep the generic default
 * (DEFAULT_PROPERTY_TAX_RATE_PCT of price), which is also labelled "assumed".
 *
 * Honesty rules for this table:
 *  - Each entry names the rule that justifies it and says how sure we are of the rate.
 *  - `approximate: true` means the rate is a rounded, typical figure, not a statewide statutory number.
 *    Actual bills vary by county, city, and special districts. These are assumptions, never "looked up".
 *  - Changing any value changes every default analysis in that state: bump ENGINE_VERSION.
 *
 * Deliberately NOT included (rule or rate not verified well enough): Michigan (Proposal A uncaps taxable value
 * on transfer), New Mexico, South Carolina, and other states with caps that reset on sale. Add them with a
 * source when someone can confirm the rate.
 */

/** Generic default for every state not in the table: 1.1% of purchase price per year (assumed). */
export const DEFAULT_PROPERTY_TAX_RATE_PCT = 1.1;

export interface ReassessmentRule {
  /** Full state name, for notes shown to users. */
  name: string;
  /** Effective annual rate as a percentage of purchase price. */
  ratePct: number;
  /** True when `ratePct` is a rounded typical value rather than a statutory rate. */
  approximate: boolean;
  /** The rule that makes the purchase price the tax basis, and the basis for the rate. */
  source: string;
}

export const PROPERTY_TAX_REASSESSMENT: Readonly<Record<string, ReassessmentRule>> = {
  CA: {
    name: "California",
    ratePct: 1.2,
    approximate: true,
    // Rule (certain): Prop 13 caps the 1% base rate and limits assessed-value growth to 2%/yr, but a change of
    // ownership reassesses to the purchase price (Prop 19 narrowed parent-child transfer exclusions in 2021).
    // Rate (approximate): 1.00% base plus voter-approved local bonds and assessments is typically 1.1-1.25%
    // of purchase price; Mello-Roos and special assessments can add more in newer developments.
    source:
      "Prop 13 / Prop 19: assessed value resets to the purchase price on change of ownership; 1% base rate plus local " +
      "assessments, typically 1.1-1.25% of price (approximate; varies by county and Mello-Roos).",
  },
  FL: {
    name: "Florida",
    ratePct: 1.5,
    approximate: true,
    // Rule (certain): Non-homestead property is reassessed to just (market) value in the year after a change of
    // ownership; the 10% annual non-homestead assessment cap and the Save Our Homes cap do not carry over to a
    // buyer. Investors do not receive the homestead exemption.
    // Rate (uncertain): total millage commonly runs about 15-20 mills (1.5-2.0%) on just value, which is a bit below
    // sale price. 1.5% is a rounded, deliberately not-low figure; verify with the county property appraiser.
    source:
      "Non-homestead property is reassessed to market value after a change of ownership (10% non-homestead cap " +
      "resets); no homestead exemption for investors. Rate is an approximate 1.5% of price: millage varies widely " +
      "by county, verify with the county property appraiser.",
  },
};

export interface DefaultPropertyTax {
  annual: number;
  ratePct: number;
  /** Explanation recorded on the assumption. */
  note: string;
  /** True when a state reassessment rule was applied. */
  reassessed: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Default annual property tax when the user did not supply one. `state` is a two-letter code (any case). */
export function defaultPropertyTax(purchasePrice: number, state?: string): DefaultPropertyTax {
  const rule = state === undefined ? undefined : PROPERTY_TAX_REASSESSMENT[state.toUpperCase()];
  if (rule) {
    const approx = rule.approximate ? " (approximate)" : "";
    return {
      annual: round2((purchasePrice * rule.ratePct) / 100),
      ratePct: rule.ratePct,
      reassessed: true,
      note:
        `${rule.name} reassesses property tax to the purchase price on sale, so tax defaults to ` +
        `${rule.ratePct}%${approx} of purchase price rather than the seller's current bill. ${rule.source}`,
    };
  }
  return {
    annual: round2((purchasePrice * DEFAULT_PROPERTY_TAX_RATE_PCT) / 100),
    ratePct: DEFAULT_PROPERTY_TAX_RATE_PCT,
    reassessed: false,
    note: `Assumed ${DEFAULT_PROPERTY_TAX_RATE_PCT}% of purchase price; no state-specific reassessment rule applied. Confirm with the county.`,
  };
}
