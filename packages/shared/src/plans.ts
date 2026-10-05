export type PlanId = "free" | "pro";

export interface Plan {
  id: PlanId;
  /** Billable analyses per calendar month. */
  monthlyAnalyses: number;
  /** what_if runs per calendar month (cheaper: they reuse saved market data). */
  monthlyWhatIfs: number;
  /** Reports carry a watermark. */
  watermark: boolean;
  /** Custom branding on reports (agent plan, 1.1). */
  branding: boolean;
}

/** PLACEHOLDER LIMITS: the product owner decides the real numbers (ARCHITECTURE §15, question 3). */
export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", monthlyAnalyses: 3, monthlyWhatIfs: 10, watermark: true, branding: false },
  pro: { id: "pro", monthlyAnalyses: 50, monthlyWhatIfs: 500, watermark: false, branding: false },
};
