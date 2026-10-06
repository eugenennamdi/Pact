"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EvidenceDto,
  PactDto,
  PrepareActionDto,
  PublicWalletActionPath,
  SettlementDto,
} from "../../../packages/product/src/public-contract";
import { decidePactAction, mayRetryVerification } from "./action-controller";
import {
  COMPLETION_DEADLINE_POLICY,
  DEADLINE_ANCHOR_EXPLANATION,
  formatResolvedDeadline,
  MAXIMUM_LIFETIME_POLICY,
} from "./deadline-copy";
import { ErrorNotice } from "./error-notice";
import { ProductApiFailure, createProductApiClient } from "./product-client";
import {
  confirmWalletTransaction,
  prepareActionForWallet,
  sendPreparedTransaction,
} from "./wallet-action";
import { useWallet } from "./wallet-boundary";
import {
  ActorBadge,
  AddressDisplay,
  CopyButton,
  ExecutionRail,
  HashDisplay,
  Icon,
  NetworkBadge,
  StatusBadge,
} from "./presentation";

const api = createProductApiClient();
const terminalStatuses = new Set(["COMPLETED", "EXPIRED", "NEEDS_ATTENTION"]);

function displayUsdc(baseUnits: string): string {
  if (!/^\d+$/.test(baseUnits)) return baseUnits;
  const value = baseUnits.padStart(7, "0");
  const whole = value.slice(0, -6);
  const fraction = value.slice(-6).replace(/0+$/, "");
  return fraction.length === 0 ? `${whole} USDC` : `${whole}.${fraction} USDC`;
}

function timestamp(value: string | null): string {
  if (value === null || !/^\d+$/.test(value)) return "Not available";
  return new Date(Number(value) * 1_000).toLocaleString();
}

function notReady(error: unknown): boolean {
  return (
    error instanceof ProductApiFailure &&
    ["EVIDENCE_NOT_READY", "SETTLEMENT_NOT_READY"].includes(error.code)
  );
}

function actionTitle(action: string): string {
  switch (action) {
    case "create-job":
    case "CREATE_JOB":
      return "Create onchain job";
    case "bind-condition":
    case "BIND_CONDITION":
      return "Bind verification condition";
    case "set-budget":
    case "SET_BUDGET":
      return "Confirm job amount";
    case "approve-usdc":
    case "APPROVE_USDC":
      return "Approve USDC";
    case "fund":
    case "FUND":
      return "Fund escrow";
    case "submit":
    case "SUBMIT":
      return "Submit work";
    default:
      return action.replace(/[_-]/g, " ");
  }
}

function WalletActionPanel({
  pact,
  refresh,
}: {
  readonly pact: PactDto;
  readonly refresh: () => Promise<void>;
}) {
  const wallet = useWallet();
  const decision = decidePactAction({
    pact,
    walletAddress: wallet.address,
    walletChainId: wallet.chainId,
    authenticated: wallet.authenticated,
  });
  const [prepared, setPrepared] = useState<PrepareActionDto | null>(null);
  const [preparedAction, setPreparedAction] =
    useState<PublicWalletActionPath | null>(null);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  useEffect(() => {
    setPrepared(null);
    setPreparedAction(null);
    setTransactionHash(null);
    setConfirmed(false);
    setError(null);
    setNotice(null);
    setShowTechnicalDetails(false);
  }, [pact.nextRequiredAction]);

  async function prepare(action: PublicWalletActionPath) {
    if (wallet.address === null || wallet.chainId === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await prepareActionForWallet({
        client: api,
        slug: pact.slug,
        action,
        idempotencyKey: `prepare:${crypto.randomUUID()}`,
        walletAddress: wallet.address,
        walletChainId: wallet.chainId,
      });
      if (result.result === "ALREADY_SATISFIED") {
        setNotice(result.summary);
        await refresh();
        return;
      }
      setPrepared(result);
      setPreparedAction(action);
    } catch (nextError) {
      if (
        nextError instanceof ProductApiFailure &&
        nextError.category === "AUTH_REQUIRED"
      )
        wallet.invalidateAuthentication();
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(hash: `0x${string}`, action: PublicWalletActionPath) {
    setBusy(true);
    setError(null);
    try {
      await confirmWalletTransaction({
        client: api,
        slug: pact.slug,
        action,
        transactionHash: hash,
      });
      setConfirmed(true);
      setNotice("Canonical confirmation complete.");
      await refresh();
    } catch (nextError) {
      if (
        nextError instanceof ProductApiFailure &&
        nextError.category === "AUTH_REQUIRED"
      )
        wallet.invalidateAuthentication();
      setConfirmed(false);
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (
      prepared === null ||
      preparedAction === null ||
      wallet.provider === null ||
      wallet.address === null
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const hash = await sendPreparedTransaction({
        provider: wallet.provider,
        walletAddress: wallet.address,
        prepared,
      });
      setTransactionHash(hash);
      setBusy(false);
      await confirm(hash, preparedAction);
    } catch (nextError) {
      if (
        nextError instanceof ProductApiFailure &&
        nextError.category === "AUTH_REQUIRED"
      )
        wallet.invalidateAuthentication();
      setConfirmed(false);
      setError(nextError);
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="action-heading">
      <div className="card-header">
        <div className="card-title-group">
          <h2 id="action-heading">Primary action surface</h2>
          <p className="card-description">
            Role-aware, prepare-first wallet interaction contract.
          </p>
        </div>
        <ActorBadge actor={pact.nextRequiredActor} />
      </div>

      {/* Decision: READY */}
      {decision.kind === "READY" && prepared === null && (
        <div className="stack" style={{ gap: "1rem" }}>
          <div
            style={{
              background: "var(--bg-subtle)",
              padding: "1rem 1.25rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <div
              style={{
                marginBottom: "0.4rem",
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  fontSize: "1rem",
                  color: "var(--text-primary)",
                }}
              >
                {actionTitle(decision.action)}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              Signer: <code>{wallet.address}</code> (
              {pact.nextRequiredActor === "CLIENT" ? "Client" : "Provider"}).
              Preparing this action computes the deterministic transaction
              payload on Arc Testnet.
            </p>
          </div>

          <div className="actions" style={{ margin: 0 }}>
            <button
              type="button"
              onClick={() => void prepare(decision.action)}
              disabled={busy}
            >
              {busy
                ? "Preparing transaction…"
                : `Prepare ${actionTitle(decision.action)}`}
            </button>
          </div>
        </div>
      )}

      {/* Decision: CONNECT */}
      {decision.kind === "CONNECT" && (
        <div className="notice stack" style={{ margin: 0, gap: "0.9rem" }}>
          <h3 style={{ margin: "0 0 0.35rem 0" }}>
            Wallet connection required
          </h3>
          <p style={{ margin: 0 }}>
            Connect the required {pact.nextRequiredActor.toLowerCase()} wallet (
            <code>
              {pact.nextRequiredActor === "CLIENT"
                ? pact.client
                : pact.provider}
            </code>
            ) to continue.
          </p>
          <div className="actions" style={{ margin: 0 }}>
            <button type="button" onClick={wallet.openConnectModal}>
              Connect to continue
            </button>
          </div>
        </div>
      )}

      {/* Decision: AUTHENTICATE */}
      {decision.kind === "AUTHENTICATE" && (
        <div className="notice stack" style={{ margin: 0, gap: "0.9rem" }}>
          <h3 style={{ margin: 0 }}>Sign in to continue</h3>
          <p style={{ margin: 0 }}>
            Sign in to Pact with the connected wallet before preparing this
            action. No transaction or gas required.
          </p>
          <div className="actions" style={{ margin: 0 }}>
            <button
              type="button"
              onClick={() => void wallet.authenticate()}
              disabled={wallet.busy}
            >
              Sign in to Pact
            </button>
          </div>
        </div>
      )}

      {/* Decision: WRONG_NETWORK */}
      {decision.kind === "WRONG_NETWORK" && (
        <div className="error stack" style={{ margin: 0, gap: "0.9rem" }}>
          <h3 style={{ margin: "0 0 0.35rem 0" }}>Wrong network</h3>
          <p style={{ margin: 0 }}>
            Pact requires Arc Testnet (Chain ID 5042002). Switch networks to
            continue.
          </p>
          <div className="actions" style={{ margin: 0 }}>
            <button
              type="button"
              onClick={() => void wallet.switchNetwork()}
              disabled={wallet.busy}
            >
              Switch to Arc Testnet
            </button>
          </div>
        </div>
      )}

      {/* Decision: WAITING_FOR_CLIENT */}
      {decision.kind === "WAITING_FOR_CLIENT" && (
        <div
          style={{
            background: "var(--bg-subtle)",
            padding: "1.25rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              marginBottom: "0.4rem",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: "1rem",
                color: "var(--text-primary)",
              }}
            >
              Waiting for client signature
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
            }}
          >
            The assigned client (<code>{pact.client}</code>) must execute{" "}
            {actionTitle(pact.nextRequiredAction)} before the lifecycle can
            advance.
          </p>
        </div>
      )}

      {/* Decision: WAITING_FOR_PROVIDER */}
      {decision.kind === "WAITING_FOR_PROVIDER" && (
        <div
          style={{
            background: "var(--bg-subtle)",
            padding: "1.25rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              marginBottom: "0.4rem",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: "1rem",
                color: "var(--text-primary)",
              }}
            >
              Waiting for provider confirmation
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
            }}
          >
            The assigned provider (<code>{pact.provider}</code>) must confirm
            the job amount before escrow funding can proceed.
          </p>
        </div>
      )}

      {/* Decision: AUTOMATED */}
      {decision.kind === "AUTOMATED" && (
        <div
          style={{
            background: "var(--accent-verified-bg)",
            padding: "1.25rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--accent-verified-border)",
          }}
        >
          <div
            style={{
              marginBottom: "0.4rem",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: "1rem",
                color: "var(--accent-verified)",
              }}
            >
              {pact.status === "AWAITING_CONDITION"
                ? "Awaiting GitHub merge condition"
                : pact.status === "VERIFYING"
                  ? "Verifying outcome on GitHub"
                  : "Settlement in progress on Arc"}
            </span>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "0.875rem",
              color: "var(--text-secondary)",
            }}
          >
            Work has been submitted. Pact is monitoring the repository and will
            independently verify the merge before settlement. No wallet action
            is required.
          </p>
        </div>
      )}

      {/* Decision: TERMINAL */}
      {decision.kind === "TERMINAL" && (
        <p
          style={{
            margin: 0,
            color: "var(--text-muted)",
            fontSize: "0.875rem",
          }}
        >
          No wallet action is available. The lifecycle is complete or finalized.
        </p>
      )}

      {wallet.message !== null && (
        <p role="alert" className="wallet-dialog-message">
          {wallet.message}
        </p>
      )}

      {/* PREPARED TRANSACTION REVIEW SURFACE */}
      {prepared?.result === "PREPARED" && (
        <div className="review-surface" style={{ marginTop: "1.25rem" }}>
          <div className="review-header">
            <h3>Confirm onchain parameters</h3>
            <p className="review-summary">{prepared.summary}</p>
          </div>

          <div className="review-grid">
            <div className="review-fact-item">
              <div className="review-fact-label">Action</div>
              <div className="review-fact-value">
                {actionTitle(prepared.action)}
              </div>
            </div>
            <div className="review-fact-item">
              <div className="review-fact-label">Signer</div>
              <div className="review-fact-value">
                <AddressDisplay address={prepared.requiredSigner} />
              </div>
            </div>
            <div className="review-fact-item">
              <div className="review-fact-label">Network</div>
              <div className="review-fact-value">
                Arc Testnet ({prepared.chainId})
              </div>
            </div>
            <div className="review-fact-item">
              <div className="review-fact-label">Contract Target</div>
              <div className="review-fact-value">
                <AddressDisplay address={prepared.to} />
              </div>
            </div>
            <div className="review-fact-item">
              <div className="review-fact-label">Native Value</div>
              <div className="review-fact-value">
                {prepared.value} native wei
              </div>
            </div>
            <div className="review-fact-item">
              <div className="review-fact-label">Expected State Transition</div>
              <div className="review-fact-value">
                {prepared.expectedStateTransition}
              </div>
            </div>
            <div className="review-fact-item">
              <div className="review-fact-label">Application Balance</div>
              <div className="review-fact-value">
                {displayUsdc(prepared.fee.erc20BalanceBaseUnits)}
              </div>
            </div>
          </div>

          <div style={{ margin: "1rem 0" }}>
            <button
              type="button"
              className="ghost btn-sm"
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              style={{ padding: "0.25rem 0.5rem" }}
            >
              <Icon
                name={showTechnicalDetails ? "chevron-down" : "chevron-right"}
              />
              <span>
                {showTechnicalDetails
                  ? "Hide technical calldata"
                  : "View technical calldata"}
              </span>
            </button>
            {showTechnicalDetails && (
              <div
                style={{
                  background: "var(--bg-subtle)",
                  padding: "0.85rem",
                  borderRadius: "var(--radius-md)",
                  marginTop: "0.5rem",
                  fontSize: "0.8125rem",
                }}
              >
                <dl style={{ margin: 0 }}>
                  <dt>Calldata hash</dt>
                  <dd>
                    <HashDisplay hash={prepared.calldataHash} />
                  </dd>
                  <dt>Target calldata</dt>
                  <dd>
                    <code className="tech-hash">{prepared.data}</code>
                  </dd>
                  <dt>Prepared block</dt>
                  <dd>{prepared.preparedAtBlock}</dd>
                  <dt>Estimated gas</dt>
                  <dd>{prepared.estimatedGas}</dd>
                </dl>
              </div>
            )}
          </div>

          <div className="actions" style={{ margin: "1rem 0 0 0" }}>
            <button type="button" onClick={() => void send()} disabled={busy}>
              {busy
                ? "Requesting wallet signature…"
                : "Send exact prepared transaction"}
            </button>
          </div>
        </div>
      )}

      {/* TRANSACTION CONFIRMATION STAGE */}
      {transactionHash !== null && !confirmed && preparedAction !== null && (
        <div
          style={{
            marginTop: "1.25rem",
            padding: "1.25rem",
            background: "var(--bg-subtle)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.75rem",
            }}
          >
            <Icon name="refresh-cw" className="rail-icon" />
            <span style={{ fontWeight: 600 }}>
              Transaction submitted to network
            </span>
          </div>
          <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem" }}>
            Hash: <HashDisplay hash={transactionHash} />
          </p>
          <p
            style={{
              margin: "0 0 1rem 0",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
            }}
          >
            Awaiting canonical server confirmation. The product state advances
            only when the transaction is reconciled by the server.
          </p>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => void confirm(transactionHash, preparedAction)}
            disabled={busy}
          >
            {busy ? "Reconciling…" : "Retry canonical confirmation"}
          </button>
        </div>
      )}

      {notice !== null && (
        <div
          className="success-callout"
          style={{ marginTop: "1rem" }}
          role="status"
        >
          <p style={{ margin: 0 }}>{notice}</p>
        </div>
      )}

      {error !== null && (
        <div style={{ marginTop: "1rem" }}>
          <ErrorNotice error={error} />
        </div>
      )}
    </section>
  );
}

function EvidenceView({ evidence }: { readonly evidence: EvidenceDto | null }) {
  return (
    <section className="card" aria-labelledby="evidence-heading">
      <div className="card-header">
        <div className="card-title-group">
          <h2 id="evidence-heading">Verification artifact</h2>
          <p className="card-description">
            Cryptographic proof generated by independent GitHub API inspection.
          </p>
        </div>
        {evidence !== null && (
          <span className="badge badge-verified">Attestation signed</span>
        )}
      </div>

      {evidence === null ? (
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0" }}>
          Canonical evidence is not ready. Evidence is generated once the pull
          request merges.
        </p>
      ) : (
        <dl>
          <dt>Target PR</dt>
          <dd>
            <strong>
              {evidence.repository}#{evidence.pullRequest}
            </strong>{" "}
            → <code>{evidence.baseBranch}</code>
          </dd>
          <dt>Outcome</dt>
          <dd>
            <strong>PR Merged</strong>
          </dd>
          <dt>Merge commit SHA</dt>
          <dd>
            <HashDisplay hash={evidence.mergeCommitSha} />
          </dd>
          <dt>Merged at</dt>
          <dd>{timestamp(evidence.mergedAt)}</dd>
          <dt>Observed at</dt>
          <dd>{timestamp(evidence.observedAt)}</dd>
          <dt>Attestation digest</dt>
          <dd>
            <HashDisplay hash={evidence.attestationDigest} />
          </dd>
          <dt>Verifier</dt>
          <dd>
            <AddressDisplay address={evidence.verifier} />
          </dd>
          <dt>Condition hash</dt>
          <dd>
            <HashDisplay hash={evidence.conditionHash} />
          </dd>
          <dt>Evidence hash</dt>
          <dd>
            <HashDisplay hash={evidence.evidenceHash} />
          </dd>
          <dt>Verified timestamp</dt>
          <dd>{timestamp(evidence.verifiedAt)}</dd>
          <dt>Validity window</dt>
          <dd>Valid until {timestamp(evidence.validUntil)}</dd>
        </dl>
      )}
    </section>
  );
}

function SettlementView({
  settlement,
}: {
  readonly settlement: SettlementDto | null;
}) {
  return (
    <section className="card" aria-labelledby="settlement-heading">
      <div className="card-header">
        <div className="card-title-group">
          <h2 id="settlement-heading">Settlement receipt</h2>
          <p className="card-description">
            Authoritative onchain ERC-8183 completion record on Arc.
          </p>
        </div>
        {settlement !== null && (
          <span className="badge badge-verified">Settled</span>
        )}
      </div>

      {settlement === null ? (
        <p style={{ color: "var(--text-muted)", margin: "0.5rem 0" }}>
          Canonical settlement is not ready. Funds remain locked in escrow until
          verified.
        </p>
      ) : (
        <dl>
          <dt>Settlement state</dt>
          <dd>
            <strong>{settlement.state}</strong>
          </dd>
          <dt>Provider payout</dt>
          <dd>
            <strong>{displayUsdc(settlement.grossProviderPayout)}</strong>{" "}
            <span style={{ color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              ({settlement.grossProviderPayout} base units)
            </span>
          </dd>
          <dt>Treasury payout</dt>
          <dd>{displayUsdc(settlement.treasuryApplicationPayout)}</dd>
          <dt>Evaluator payout</dt>
          <dd>{displayUsdc(settlement.evaluatorApplicationPayout)}</dd>
          <dt>Settlement tx</dt>
          <dd>
            <HashDisplay hash={settlement.transactionHash} />
          </dd>
          <dt>Receipt block</dt>
          <dd>Block #{settlement.receiptBlockNumber}</dd>
          <dt>ERC-8183 job ID</dt>
          <dd>#{settlement.jobId}</dd>
          <dt>Final job status</dt>
          <dd>Status {settlement.finalJobStatus} (Completed)</dd>
          <dt>Pact binding</dt>
          <dd>{settlement.bindingAccepted ? "Accepted" : "Rejected"}</dd>
          <dt>Broadcast count</dt>
          <dd>{settlement.broadcastAttemptCount} relay attempt(s)</dd>
          <dt>Evidence hash</dt>
          <dd>
            <HashDisplay hash={settlement.evidenceHash} />
          </dd>
        </dl>
      )}
    </section>
  );
}

export function PactDetail({ slug }: { readonly slug: string }) {
  const wallet = useWallet();
  const [pact, setPact] = useState<PactDto | null>(null);
  const [evidence, setEvidence] = useState<EvidenceDto | null>(null);
  const [settlement, setSettlement] = useState<SettlementDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retrying, setRetrying] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const nextPact = await api.getPact(slug);
      setPact(nextPact);
      setError(null);
      try {
        setEvidence(await api.getEvidence(slug));
      } catch (nextError) {
        if (!notReady(nextError)) throw nextError;
        setEvidence(null);
      }
      try {
        setSettlement(await api.getSettlement(slug));
      } catch (nextError) {
        if (!notReady(nextError)) throw nextError;
        setSettlement(null);
      }
    } catch (nextError) {
      if (
        nextError instanceof ProductApiFailure &&
        nextError.category === "AUTH_REQUIRED"
      )
        wallet.invalidateAuthentication();
      setError(nextError);
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (pact === null || terminalStatuses.has(pact.status)) return;
    let timer: number | undefined;
    const schedule = () => {
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(async () => {
          await refresh();
          schedule();
        }, 7_000);
      }
    };
    const visibility = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        void refresh();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pact, refresh]);

  const retryAllowed = useMemo(
    () =>
      pact !== null &&
      mayRetryVerification(pact, wallet.address, wallet.authenticated),
    [pact, wallet.address, wallet.authenticated],
  );

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      await api.retryVerification(slug, `retry:${crypto.randomUUID()}`);
      await refresh();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setRetrying(false);
    }
  }

  if (pact === null) {
    return (
      <div className="stack" style={{ gap: "1.5rem" }}>
        <section
          className="card"
          style={{ padding: "3rem 2rem", textAlign: "center" }}
        >
          <p
            role="status"
            style={{
              fontSize: "1.1rem",
              color: "var(--text-secondary)",
              margin: 0,
            }}
          >
            Loading canonical Pact state…
          </p>
        </section>
        {error !== null && <ErrorNotice error={error} />}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: "2rem" }}>
      {/* Top Workspace Header */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <span className="eyebrow" style={{ margin: 0 }}>
            Pact Workspace
          </span>
          <span style={{ color: "var(--border-strong)" }}>/</span>
          <span className="tech-address-wrapper">
            <code className="tech-hash">{pact.slug}</code>
            <CopyButton text={pact.slug} label="Copy slug" />
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <h1 style={{ margin: "0 0 0.5rem 0" }}>
              {pact.repository}#{pact.pullRequest}
            </h1>
            <p className="lede" style={{ margin: 0 }}>
              Settle {displayUsdc(pact.amountBaseUnits)} upon verified merge
              into <code>{pact.baseBranch}</code>.
            </p>
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
          >
            <StatusBadge status={pact.status} />
            <NetworkBadge network={pact.network} chainId={pact.chainId} />
          </div>
        </div>

        {/* Highlights Bar */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(13rem, 1fr))",
            gap: "1rem",
            padding: "1rem 1.25rem",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-xs)",
          }}
        >
          <div>
            <div className="review-fact-label">Escrow Amount</div>
            <div
              style={{
                fontSize: "1.15rem",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {displayUsdc(pact.amountBaseUnits)}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {pact.amountBaseUnits} base units
            </div>
          </div>
          <div>
            <div className="review-fact-label">Next Actor</div>
            <div style={{ marginTop: "0.25rem" }}>
              <ActorBadge actor={pact.nextRequiredActor} />
            </div>
          </div>
          <div>
            <div className="review-fact-label">Next Action</div>
            <div
              style={{
                fontSize: "0.9375rem",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {actionTitle(pact.nextRequiredAction)}
            </div>
          </div>
          <div>
            <div className="review-fact-label">Assigned Provider</div>
            <div style={{ marginTop: "0.25rem" }}>
              <AddressDisplay address={pact.provider} />
            </div>
          </div>
        </div>
      </div>

      {/* Execution Rail */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span className="eyebrow" style={{ margin: 0 }}>
            Settlement Lifecycle
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            ERC-8183 Deterministic State
          </span>
        </div>
        <ExecutionRail pact={pact} />
      </div>

      {/* Main Action Panel */}
      <WalletActionPanel pact={pact} refresh={refresh} />

      {/* Retry Verification (Secondary action only when permitted) */}
      {retryAllowed && (
        <section
          className="card"
          style={{
            background: "var(--bg-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
            padding: "1.25rem 1.5rem",
          }}
        >
          <div>
            <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1rem" }}>
              Manual verification check
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                color: "var(--text-secondary)",
              }}
            >
              Trigger an immediate check against GitHub authoritative API
              without waiting for the polling worker.
            </p>
          </div>
          <button
            type="button"
            className="secondary btn-sm"
            onClick={() => void retry()}
            disabled={retrying}
          >
            {retrying ? "Checking GitHub…" : "Trigger verification check"}
          </button>
        </section>
      )}

      {/* Wallet Action History Table */}
      <section className="card" aria-labelledby="history-heading">
        <div className="card-header">
          <div className="card-title-group">
            <h2 id="history-heading">Confirmed wallet actions</h2>
            <p className="card-description">
              Authoritative onchain transaction history for this Pact.
            </p>
          </div>
          <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
            {pact.walletActions.length} of 6 confirmed
          </span>
        </div>

        {pact.walletActions.length === 0 ? (
          <p style={{ color: "var(--text-muted)", margin: "0.5rem 0" }}>
            No onchain actions are confirmed yet. Client must create the onchain
            job.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Signer</th>
                  <th>Status</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {pact.walletActions.map((action) => (
                  <tr key={action.action}>
                    <td>
                      <strong>{actionTitle(action.action)}</strong>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {action.action}
                      </div>
                    </td>
                    <td>
                      <AddressDisplay address={action.requiredSigner} />
                    </td>
                    <td>
                      <span className="badge badge-verified">
                        <span className="badge-dot" />
                        {action.confirmationStatus}
                      </span>
                    </td>
                    <td>
                      {action.transactionHash ? (
                        <HashDisplay hash={action.transactionHash} />
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>
                          None required
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Evidence & Settlement Grid */}
      <div className="grid">
        <EvidenceView evidence={evidence} />
        <SettlementView settlement={settlement} />
      </div>

      {/* Technical Protocol Metadata Accordion / Panel */}
      <section className="card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            cursor: "pointer",
          }}
          onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
        >
          <div>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>
              Technical protocol specifications
            </h2>
            <p
              style={{
                margin: "0.25rem 0 0 0",
                fontSize: "0.8125rem",
                color: "var(--text-secondary)",
              }}
            >
              Deterministic hashes, contract targets, and deadline policies.
            </p>
          </div>
          <button
            type="button"
            className="ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowTechnicalDetails(!showTechnicalDetails);
            }}
          >
            <Icon
              name={showTechnicalDetails ? "chevron-down" : "chevron-right"}
            />
            <span>{showTechnicalDetails ? "Collapse" : "Expand"}</span>
          </button>
        </div>

        {showTechnicalDetails && (
          <div
            style={{
              borderTop: "1px solid var(--border-subtle)",
              marginTop: "1rem",
              paddingTop: "1rem",
            }}
          >
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "0.8125rem",
                margin: "0 0 1rem",
              }}
            >
              {DEADLINE_ANCHOR_EXPLANATION}
            </p>
            <dl>
              <dt>Client address</dt>
              <dd>
                <AddressDisplay address={pact.client} />
              </dd>
              <dt>Provider address</dt>
              <dd>
                <AddressDisplay address={pact.provider} />
              </dd>
              <dt>Condition hash</dt>
              <dd>
                <HashDisplay hash={pact.conditionHash} />
              </dd>
              <dt>Job ID</dt>
              <dd>{pact.jobId ?? "Not linked"}</dd>
              <dt>Job key</dt>
              <dd>
                {pact.jobKey ? (
                  <HashDisplay hash={pact.jobKey} />
                ) : (
                  "Not linked"
                )}
              </dd>
              <dt>Commerce contract</dt>
              <dd>
                <AddressDisplay address={pact.commerceAddress} />
              </dd>
              <dt>Evaluator contract</dt>
              <dd>
                <AddressDisplay address={pact.evaluatorAddress} />
              </dd>
              <dt>Completion deadline</dt>
              <dd>
                {formatResolvedDeadline(
                  pact.completionDeadline,
                  COMPLETION_DEADLINE_POLICY,
                )}
              </dd>
              <dt>Maximum lifetime</dt>
              <dd>
                {formatResolvedDeadline(pact.expiry, MAXIMUM_LIFETIME_POLICY)}
              </dd>
            </dl>
          </div>
        )}
      </section>

      {error !== null && <ErrorNotice error={error} />}
    </div>
  );
}
