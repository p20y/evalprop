/** Fixed-rate monthly principal & interest payment. */
export function monthlyPayment(loan: number, annualRatePct: number, termYears: number): number {
  if (loan <= 0) return 0;
  const n = termYears * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return loan / n;
  return (loan * r) / (1 - Math.pow(1 + r, -n));
}

/** Remaining balance after `month` payments (0 once the loan term has elapsed). */
export function balanceAfter(loan: number, annualRatePct: number, termYears: number, month: number): number {
  if (loan <= 0) return 0;
  const n = termYears * 12;
  if (month >= n) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return loan * (1 - month / n);
  const pmt = monthlyPayment(loan, annualRatePct, termYears);
  return loan * Math.pow(1 + r, month) - pmt * ((Math.pow(1 + r, month) - 1) / r);
}
