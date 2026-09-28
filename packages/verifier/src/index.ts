/** Browser-safe status names only. Server implementations live in explicit subpaths. */
export type VerificationStatus =
  "SATISFIED" | "NOT_SATISFIED" | "INDETERMINATE";

export const VERIFIER_IMPLEMENTATION_STATUS = "phase-3" as const;
