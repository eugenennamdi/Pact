"use client";

import { useState, type ReactNode } from "react";
import type { PactDto } from "../../../packages/product/src/public-contract";

export function Icon({
  name,
  className = "icon",
}: {
  readonly name:
    | "check"
    | "copy"
    | "external-link"
    | "arrow-right"
    | "shield-check"
    | "git-pull-request"
    | "git-merge"
    | "lock"
    | "clock"
    | "alert-circle"
    | "wallet"
    | "info"
    | "check-circle"
    | "chevron-down"
    | "chevron-right"
    | "refresh-cw";
  readonly className?: string;
}) {
  switch (name) {
    case "check":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "copy":
      return (
        <svg
          className={className}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case "external-link":
      return (
        <svg
          className={className}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      );
    case "shield-check":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      );
    case "git-pull-request":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M13 6h3a2 2 0 0 1 2 2v7" />
          <line x1="6" y1="9" x2="6" y2="21" />
        </svg>
      );
    case "git-merge":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M6 21V9a9 9 0 0 0 9 9" />
        </svg>
      );
    case "lock":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case "clock":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "alert-circle":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "wallet":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        </svg>
      );
    case "info":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
    case "check-circle":
      return (
        <svg
          className={className}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg
          className={className}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg
          className={className}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case "refresh-cw":
      return (
        <svg
          className={className}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
  }
}

export function CopyButton({
  text,
  label = "Copy",
}: {
  readonly text: string;
  readonly label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Fallback
    }
  }

  return (
    <button
      type="button"
      className="btn-copy"
      onClick={() => void handleCopy()}
      aria-label={`${label} to clipboard`}
      title={copied ? "Copied!" : `${label}: ${text}`}
    >
      {copied ? (
        <>
          <Icon name="check" className="icon-copy-check" />
          <span className="copy-label">Copied</span>
        </>
      ) : (
        <>
          <Icon name="copy" className="icon-copy" />
          <span className="copy-label">{label}</span>
        </>
      )}
    </button>
  );
}

export function truncateHex(hex: string, keep = 6): string {
  if (!hex || hex.length <= keep * 2 + 2) return hex;
  return `${hex.slice(0, keep + 2)}…${hex.slice(-keep)}`;
}

export function AddressDisplay({
  address,
  truncate = true,
  copyable = true,
}: {
  readonly address: string;
  readonly truncate?: boolean;
  readonly copyable?: boolean;
}) {
  const display = truncate ? truncateHex(address, 4) : address;
  return (
    <span className="tech-address-wrapper" title={address}>
      <code className="tech-hash">{display}</code>
      {copyable && <CopyButton text={address} label="Copy address" />}
    </span>
  );
}

export function HashDisplay({
  hash,
  truncate = true,
  copyable = true,
}: {
  readonly hash: string;
  readonly truncate?: boolean;
  readonly copyable?: boolean;
}) {
  const display = truncate ? truncateHex(hash, 6) : hash;
  return (
    <span className="tech-address-wrapper" title={hash}>
      <code className="tech-hash">{display}</code>
      {copyable && <CopyButton text={hash} label="Copy hash" />}
    </span>
  );
}

export function StatusBadge({ status }: { readonly status: string }) {
  let variant = "badge-neutral";
  const label = status.replace(/_/g, " ");

  if (
    status === "COMPLETED" ||
    status === "SETTLED" ||
    status === "CONFIRMED"
  ) {
    variant = "badge-verified";
  } else if (
    status === "ACTION_REQUIRED" ||
    status === "AWAITING_CONDITION" ||
    status === "VERIFYING" ||
    status === "SETTLING"
  ) {
    variant = "badge-pending";
  } else if (status === "NEEDS_ATTENTION" || status === "EXPIRED") {
    variant = "badge-error";
  }

  return (
    <span className={`badge ${variant}`} role="status">
      <span className="badge-dot" />
      {label}
    </span>
  );
}

export function ActorBadge({ actor }: { readonly actor: string }) {
  let label = actor;
  let variant = "badge-neutral";
  if (actor === "CLIENT") {
    label = "Client";
    variant = "badge-client";
  } else if (actor === "PROVIDER") {
    label = "Provider";
    variant = "badge-provider";
  } else if (actor === "PACT") {
    label = "Pact Automated";
    variant = "badge-pact";
  }
  return <span className={`badge ${variant}`}>{label}</span>;
}

export function NetworkBadge({
  network,
  chainId,
}: {
  readonly network: string;
  readonly chainId?: number;
}) {
  return (
    <span className="network-badge">
      <span className="network-indicator" />
      {network === "arc-testnet" || chainId === 5042002
        ? "Arc Testnet (5042002)"
        : network === "arc-mainnet" || chainId === 5042
          ? "Arc Mainnet (5042)"
          : `${network} (${chainId ?? "unknown"})`}
    </span>
  );
}

const LIFECYCLE_STEPS = [
  { key: "CREATE_JOB", label: "Job Created", actor: "Client" },
  { key: "BIND_CONDITION", label: "Condition Bound", actor: "Client" },
  { key: "SET_BUDGET", label: "Amount Confirmed", actor: "Provider" },
  { key: "APPROVE_USDC", label: "USDC Approved", actor: "Client" },
  { key: "FUND", label: "Escrow Funded", actor: "Client" },
  { key: "SUBMIT", label: "Work Submitted", actor: "Provider" },
  { key: "VERIFY", label: "Condition Verified", actor: "Pact" },
  { key: "SETTLE", label: "Settlement Complete", actor: "Relay" },
] as const;

export function ExecutionRail({ pact }: { readonly pact: PactDto }) {
  const confirmedKinds = new Set(
    pact.walletActions
      .filter((action) => action.confirmationStatus === "CONFIRMED")
      .map((action) => action.action),
  );

  const isCompleted = pact.status === "COMPLETED";
  const isSettling = pact.status === "SETTLING";
  const isVerifying = pact.status === "VERIFYING";
  const isAwaiting = pact.status === "AWAITING_CONDITION";

  // Determine current active step index (0 to 7)
  let activeIndex = 0;
  if (isCompleted) {
    activeIndex = 7;
  } else if (isSettling) {
    activeIndex = 7;
  } else if (isVerifying || pact.nextRequiredAction === "VERIFY") {
    activeIndex = 6;
  } else if (isAwaiting) {
    activeIndex = 6;
  } else {
    // Check wallet actions in order
    if (confirmedKinds.has("SUBMIT")) {
      activeIndex = 6;
    } else if (confirmedKinds.has("FUND")) {
      activeIndex = 5;
    } else if (confirmedKinds.has("APPROVE_USDC")) {
      activeIndex = 4;
    } else if (confirmedKinds.has("SET_BUDGET")) {
      activeIndex = 3;
    } else if (confirmedKinds.has("BIND_CONDITION")) {
      activeIndex = 2;
    } else if (confirmedKinds.has("CREATE_JOB")) {
      activeIndex = 1;
    } else {
      activeIndex = 0;
    }
  }

  return (
    <div className="execution-rail-container" aria-label="Settlement lifecycle">
      <div className="rail-steps">
        {LIFECYCLE_STEPS.map((step, idx) => {
          let state: "completed" | "current" | "upcoming" = "upcoming";

          if (idx < 6) {
            if (confirmedKinds.has(step.key as never)) {
              state = "completed";
            } else if (idx === activeIndex) {
              state = "current";
            }
          } else if (idx === 6) {
            // VERIFY step
            if (isCompleted || pact.evidence !== null) {
              state = "completed";
            } else if (idx === activeIndex) {
              state = "current";
            }
          } else if (idx === 7) {
            // SETTLE step
            if (isCompleted || pact.settlement !== null) {
              state = "completed";
            } else if (idx === activeIndex) {
              state = "current";
            }
          }

          return (
            <div
              key={step.key}
              className={`rail-step rail-step-${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <div className="rail-node">
                {state === "completed" ? (
                  <Icon name="check" className="rail-icon" />
                ) : (
                  <span className="rail-number">{idx + 1}</span>
                )}
              </div>
              <div className="rail-content">
                <span className="rail-label">{step.label}</span>
                <span className="rail-actor">{step.actor}</span>
              </div>
              {idx < LIFECYCLE_STEPS.length - 1 && (
                <div
                  className={`rail-connector ${
                    idx < activeIndex || isCompleted
                      ? "rail-connector-active"
                      : ""
                  }`}
                  aria-hidden="true"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MetaRow({
  label,
  value,
  mono = false,
  copyable = false,
  children,
}: {
  readonly label: string;
  readonly value?: string | number | null;
  readonly mono?: boolean;
  readonly copyable?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <div className="meta-row">
      <dt className="meta-key">{label}</dt>
      <dd className="meta-val">
        {children ? (
          children
        ) : mono && typeof value === "string" ? (
          copyable ? (
            <span className="tech-address-wrapper">
              <code className="tech-hash">{value}</code>
              <CopyButton text={value} label={`Copy ${label}`} />
            </span>
          ) : (
            <code className="tech-hash">{value}</code>
          )
        ) : (
          <span>{value ?? "—"}</span>
        )}
      </dd>
    </div>
  );
}
