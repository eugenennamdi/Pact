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
import { ErrorNotice } from "./error-notice";
import { ProductApiFailure, createProductApiClient } from "./product-client";
import {
  confirmWalletTransaction,
  prepareActionForWallet,
  sendPreparedTransaction,
} from "./wallet-action";
import { WalletControls, useWallet } from "./wallet-boundary";

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

  useEffect(() => {
    setPrepared(null);
    setPreparedAction(null);
    setTransactionHash(null);
    setConfirmed(false);
    setError(null);
    setNotice(null);
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
      <h2 id="action-heading">Next action</h2>
      {decision.kind === "READY" && prepared === null && (
        <button
          type="button"
          onClick={() => void prepare(decision.action)}
          disabled={busy}
        >
          Prepare {decision.label}
        </button>
      )}
      {decision.kind === "CONNECT" && <p>Connect the required wallet.</p>}
      {decision.kind === "AUTHENTICATE" && (
        <p>Authenticate the connected wallet before preparing this action.</p>
      )}
      {decision.kind === "WRONG_NETWORK" && <p>WRONG_NETWORK</p>}
      {decision.kind === "WAITING_FOR_CLIENT" && <p>Waiting for client.</p>}
      {decision.kind === "WAITING_FOR_PROVIDER" && <p>Waiting for provider.</p>}
      {decision.kind === "AUTOMATED" && (
        <p>
          Verification and settlement continue automatically. No wallet action
          is required.
        </p>
      )}
      {decision.kind === "TERMINAL" && <p>No wallet action is available.</p>}
      {prepared?.result === "PREPARED" && (
        <div className="notice">
          <h3>Confirm prepared transaction</h3>
          <p>{prepared.summary}</p>
          <dl>
            <dt>Action</dt>
            <dd>{prepared.action}</dd>
            <dt>Signer</dt>
            <dd className="hash">{prepared.requiredSigner}</dd>
            <dt>Network</dt>
            <dd>Arc Testnet ({prepared.chainId})</dd>
            <dt>Contract target</dt>
            <dd className="hash">{prepared.to}</dd>
            <dt>Native value</dt>
            <dd>{prepared.value}</dd>
            <dt>Expected transition</dt>
            <dd>{prepared.expectedStateTransition}</dd>
            <dt>Application balance</dt>
            <dd>{displayUsdc(prepared.fee.erc20BalanceBaseUnits)}</dd>
          </dl>
          <button type="button" onClick={() => void send()} disabled={busy}>
            Send exact prepared transaction
          </button>
        </div>
      )}
      {transactionHash !== null && !confirmed && preparedAction !== null && (
        <div>
          <p className="hash">Submitted transaction: {transactionHash}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => void confirm(transactionHash, preparedAction)}
            disabled={busy}
          >
            Retry canonical confirmation
          </button>
        </div>
      )}
      {notice !== null && <p role="status">{notice}</p>}
      {error !== null && <ErrorNotice error={error} />}
    </section>
  );
}

function EvidenceView({ evidence }: { readonly evidence: EvidenceDto | null }) {
  return (
    <section className="card" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">Evidence</h2>
      {evidence === null ? (
        <p>Canonical evidence is not ready.</p>
      ) : (
        <dl>
          <dt>Condition hash</dt>
          <dd className="hash">{evidence.conditionHash}</dd>
          <dt>Evidence hash</dt>
          <dd className="hash">{evidence.evidenceHash}</dd>
          <dt>GitHub condition</dt>
          <dd>
            {evidence.repository}#{evidence.pullRequest} → {evidence.baseBranch}
          </dd>
          <dt>Merge SHA</dt>
          <dd className="hash">{evidence.mergeCommitSha}</dd>
          <dt>Merged</dt>
          <dd>{timestamp(evidence.mergedAt)}</dd>
          <dt>Observed</dt>
          <dd>{timestamp(evidence.observedAt)}</dd>
          <dt>Attestation digest</dt>
          <dd className="hash">{evidence.attestationDigest}</dd>
          <dt>Verifier</dt>
          <dd className="hash">{evidence.verifier}</dd>
          <dt>Verified</dt>
          <dd>{timestamp(evidence.verifiedAt)}</dd>
          <dt>Valid until</dt>
          <dd>{timestamp(evidence.validUntil)}</dd>
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
      <h2 id="settlement-heading">Settlement</h2>
      {settlement === null ? (
        <p>Canonical settlement is not ready.</p>
      ) : (
        <dl>
          <dt>Job</dt>
          <dd>{settlement.jobId}</dd>
          <dt>Job key</dt>
          <dd className="hash">{settlement.jobKey}</dd>
          <dt>Chain</dt>
          <dd>{settlement.chainId}</dd>
          <dt>Commerce</dt>
          <dd className="hash">{settlement.commerce}</dd>
          <dt>Evaluator</dt>
          <dd className="hash">{settlement.evaluator}</dd>
          <dt>Transaction</dt>
          <dd className="hash">{settlement.transactionHash}</dd>
          <dt>Receipt block</dt>
          <dd>{settlement.receiptBlockNumber}</dd>
          <dt>Final job state</dt>
          <dd>{settlement.finalJobStatus}</dd>
          <dt>Binding accepted</dt>
          <dd>{settlement.bindingAccepted ? "Yes" : "No"}</dd>
          <dt>Broadcast attempts</dt>
          <dd>{settlement.broadcastAttemptCount}</dd>
          <dt>Budget</dt>
          <dd>{displayUsdc(settlement.grossBudget)}</dd>
          <dt>Provider payout</dt>
          <dd>{displayUsdc(settlement.grossProviderPayout)}</dd>
          <dt>Treasury application payout</dt>
          <dd>{displayUsdc(settlement.treasuryApplicationPayout)}</dd>
          <dt>Evaluator application payout</dt>
          <dd>{displayUsdc(settlement.evaluatorApplicationPayout)}</dd>
          <dt>Evidence hash</dt>
          <dd className="hash">{settlement.evidenceHash}</dd>
          <dt>Completion reason</dt>
          <dd className="hash">{settlement.completionReason}</dd>
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
      <>
        <WalletControls />
        <p role="status">Loading canonical Pact state…</p>
        {error !== null && <ErrorNotice error={error} />}
      </>
    );
  }

  return (
    <>
      <div className="grid">
        <WalletControls />
        <section className="card" aria-labelledby="pact-summary-heading">
          <h2 id="pact-summary-heading">Pact state</h2>
          <p className="status" role="status">
            {pact.status}
          </p>
          <dl>
            <dt>Condition</dt>
            <dd>
              {pact.repository}#{pact.pullRequest} → {pact.baseBranch}
            </dd>
            <dt>Amount</dt>
            <dd>{displayUsdc(pact.amountBaseUnits)}</dd>
            <dt>Client</dt>
            <dd className="hash">{pact.client}</dd>
            <dt>Provider</dt>
            <dd className="hash">{pact.provider}</dd>
            <dt>Chain</dt>
            <dd>{pact.chainId} / Arc Testnet</dd>
            <dt>Condition hash</dt>
            <dd className="hash">{pact.conditionHash}</dd>
            <dt>Job ID</dt>
            <dd>{pact.jobId ?? "Not linked"}</dd>
            <dt>Job key</dt>
            <dd className="hash">{pact.jobKey ?? "Not linked"}</dd>
            <dt>Completion deadline</dt>
            <dd>{timestamp(pact.completionDeadline)}</dd>
            <dt>Expiry</dt>
            <dd>{timestamp(pact.expiry)}</dd>
            <dt>Next actor</dt>
            <dd>{pact.nextRequiredActor}</dd>
            <dt>Next action</dt>
            <dd>{pact.nextRequiredAction}</dd>
          </dl>
        </section>
      </div>
      <WalletActionPanel pact={pact} refresh={refresh} />
      {retryAllowed && (
        <section className="card">
          <h2>Verification</h2>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
          >
            Retry verification
          </button>
        </section>
      )}
      <section className="card" aria-labelledby="history-heading">
        <h2 id="history-heading">Wallet action history</h2>
        {pact.walletActions.length === 0 ? (
          <p>No wallet actions are confirmed yet.</p>
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
                    <td>{action.action}</td>
                    <td className="hash">{action.requiredSigner}</td>
                    <td>{action.confirmationStatus}</td>
                    <td className="hash">
                      {action.transactionHash ?? "No transaction required"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="grid">
        <EvidenceView evidence={evidence} />
        <SettlementView settlement={settlement} />
      </div>
      {error !== null && <ErrorNotice error={error} />}
    </>
  );
}
