export const COMPLETION_DEADLINE_POLICY =
  "2 hours from job preparation" as const;
export const MAXIMUM_LIFETIME_POLICY =
  "6 hours maximum lifetime from job preparation" as const;
export const DEADLINE_ANCHOR_EXPLANATION =
  "Pact derives both deadlines from the Arc block timestamp used when the CREATE_JOB transaction is prepared." as const;

export function formatResolvedDeadline(
  value: string | null,
  relativePolicy: string,
): string {
  if (value === null) return relativePolicy;
  if (!/^\d+$/.test(value)) return "Not available";
  return `${new Date(Number(value) * 1_000).toLocaleString()} (${relativePolicy})`;
}
