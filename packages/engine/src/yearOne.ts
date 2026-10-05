import { monthlyPayment } from "./mortgage.ts";
import type { ResolvedInput, YearOneMetrics } from "./types.ts";

const pct = (n: number) => n / 100;

export function cashInvestedFor(i: ResolvedInput): number {
  return i.purchasePrice * pct(i.downPaymentPct) + i.purchasePrice * pct(i.closingCostPct) + i.rehabCost;
}

export function yearOne(i: ResolvedInput): YearOneMetrics {
  const grossAnnualRent = i.monthlyRent * 12;
  const vacancyLoss = grossAnnualRent * pct(i.vacancyPct);
  const effectiveRent = grossAnnualRent - vacancyLoss;

  const hoa = i.hoaMonthly * 12;
  const maintenance = grossAnnualRent * pct(i.maintenancePct);
  const capex = grossAnnualRent * pct(i.capexPct);
  const management = effectiveRent * pct(i.managementPct);
  const total = i.propertyTaxAnnual + i.insuranceAnnual + hoa + maintenance + capex + management;
  const noi = effectiveRent - total;

  const loanAmount = i.purchasePrice * (1 - pct(i.downPaymentPct));
  const pmt = monthlyPayment(loanAmount, i.interestRatePct, i.loanTermYears);
  const annualDebtService = pmt * 12;
  const annualCashFlow = noi - annualDebtService;
  const cashInvested = cashInvestedFor(i);

  // Occupancy o solves: o*G*(1 - mgmt) - tax - ins - hoa - (maint+capex)*G - debt = 0
  const collectedPerOccupancy = grossAnnualRent * (1 - pct(i.managementPct));
  const breakEvenOccupancyPct =
    collectedPerOccupancy > 0
      ? Math.min(
          999,
          ((i.propertyTaxAnnual + i.insuranceAnnual + hoa + maintenance + capex + annualDebtService) /
            collectedPerOccupancy) *
            100,
        )
      : 999;

  return {
    grossAnnualRent,
    vacancyLoss,
    effectiveRent,
    operatingExpenses: {
      propertyTax: i.propertyTaxAnnual,
      insurance: i.insuranceAnnual,
      hoa,
      maintenance,
      capex,
      management,
      total,
    },
    noi,
    loanAmount,
    monthlyPrincipalAndInterest: pmt,
    annualDebtService,
    annualCashFlow,
    monthlyCashFlow: annualCashFlow / 12,
    cashInvested,
    capRatePct: (noi / i.purchasePrice) * 100,
    cashOnCashPct: cashInvested > 0 ? (annualCashFlow / cashInvested) * 100 : 0,
    dscr: annualDebtService > 0 ? noi / annualDebtService : null,
    grossRentMultiplier: grossAnnualRent > 0 ? i.purchasePrice / grossAnnualRent : Infinity,
    rentToPricePct: (i.monthlyRent / (i.purchasePrice + i.rehabCost)) * 100,
    breakEvenOccupancyPct,
    fiftyPercentRuleMonthlyCashFlow: i.monthlyRent * 0.5 - pmt,
  };
}
