import { irr } from "./irr.ts";
import { balanceAfter, monthlyPayment } from "./mortgage.ts";
import { cashInvestedFor } from "./yearOne.ts";
import type { HoldAnalysis, ResolvedInput, YearRow } from "./types.ts";

const pct = (n: number) => n / 100;

/** Month-by-month simulation, rolled up into year rows. Rent and expenses step up each January-of-hold-year. */
export function holdAnalysis(i: ResolvedInput): HoldAnalysis {
  const cashInvested = cashInvestedFor(i);
  const loan = i.purchasePrice * (1 - pct(i.downPaymentPct));
  const pmt = monthlyPayment(loan, i.interestRatePct, i.loanTermYears);
  const loanMonths = i.loanTermYears * 12;

  const netProceedsAt = (month: number) => {
    const value = i.purchasePrice * Math.pow(1 + pct(i.appreciationPct), month / 12);
    const balance = balanceAfter(loan, i.interestRatePct, i.loanTermYears, month);
    return { value, balance, net: value * (1 - pct(i.sellingCostPct)) - balance };
  };

  const years: YearRow[] = [];
  let cumulative = 0;
  let cashPaybackMonth: number | null = null;
  let breakEvenMonth: number | null = null;

  for (let y = 0; y < i.holdYears; y++) {
    const gross = i.monthlyRent * 12 * Math.pow(1 + pct(i.rentGrowthPct), y);
    const effective = gross * (1 - pct(i.vacancyPct));
    const growth = Math.pow(1 + pct(i.expenseGrowthPct), y);
    const opex =
      (i.propertyTaxAnnual + i.insuranceAnnual + i.hoaMonthly * 12) * growth +
      gross * (pct(i.maintenancePct) + pct(i.capexPct)) +
      effective * pct(i.managementPct);
    const noi = effective - opex;

    let debtService = 0;
    let yearCashFlow = 0;
    for (let m = y * 12 + 1; m <= (y + 1) * 12; m++) {
      const debt = m <= loanMonths ? pmt : 0;
      const monthlyCf = noi / 12 - debt;
      debtService += debt;
      yearCashFlow += monthlyCf;
      cumulative += monthlyCf;
      if (cashPaybackMonth === null && cumulative >= cashInvested) cashPaybackMonth = m;
      if (breakEvenMonth === null && cumulative + netProceedsAt(m).net - cashInvested >= 0) breakEvenMonth = m;
    }

    const end = netProceedsAt((y + 1) * 12);
    years.push({
      year: y + 1,
      grossRent: gross,
      operatingExpenses: opex,
      noi,
      debtService,
      cashFlow: yearCashFlow,
      cumulativeCashFlow: cumulative,
      propertyValue: end.value,
      loanBalance: end.balance,
      equity: end.value - end.balance,
      netSaleProceeds: end.net,
      totalProfit: cumulative + end.net - cashInvested,
    });
  }

  const horizonYears = [...new Set([5, 10, 20, i.holdYears].filter((h) => h <= i.holdYears))].sort((a, b) => a - b);
  const horizons = horizonYears.map((h) => {
    const flows = [-cashInvested, ...years.slice(0, h).map((r) => r.cashFlow)];
    flows[h] += years[h - 1].netSaleProceeds;
    const row = years[h - 1];
    const irrValue = irr(flows);
    return {
      years: h,
      totalProfit: row.totalProfit,
      equityMultiple: cashInvested > 0 ? (row.cumulativeCashFlow + row.netSaleProceeds) / cashInvested : 0,
      irrPct: irrValue === null ? null : irrValue * 100,
    };
  });

  return { years, cashPaybackMonth, breakEvenMonth, horizons };
}
