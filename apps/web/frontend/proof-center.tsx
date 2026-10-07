import Link from "next/link";
import type { SettlementProofArtifact } from "../proof/schema";
import { AddressDisplay, HashDisplay, NetworkBadge } from "./presentation";

function timestamp(value: string): string {
  return new Date(Number(value) * 1_000).toISOString();
}

function ExplorerTransaction({
  proof,
  hash,
}: {
  readonly proof: SettlementProofArtifact;
  readonly hash: string;
}) {
  return (
    <span className="proof-value-with-link">
      <HashDisplay hash={hash} />
      <a
        href={`${proof.explorerBaseUrl}/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open transaction ${hash} in Arc explorer`}
      >
        Explorer ↗
      </a>
    </span>
  );
}

function DetailValue({
  label,
  value,
  kind = "text",
}: {
  readonly label: string;
  readonly value: string;
  readonly kind?: "address" | "hash" | "text";
}) {
  return (
    <div className="proof-detail-row">
      <dt>{label}</dt>
      <dd>
        {kind === "address" ? (
          <AddressDisplay address={value} truncate={false} />
        ) : kind === "hash" ? (
          <HashDisplay hash={value} truncate={false} />
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function ProofDetails({ proof }: { readonly proof: SettlementProofArtifact }) {
  return (
    <div className="proof-details-grid">
      <details>
        <summary>Network / contracts</summary>
        <dl>
          <DetailValue label="Chain ID" value={String(proof.chainId)} />
          <DetailValue
            label="ERC-8183 proxy"
            value={proof.contracts.commerce}
            kind="address"
          />
          <DetailValue
            label="ERC-8183 implementation"
            value={proof.contracts.implementation}
            kind="address"
          />
          <DetailValue
            label="PactEvaluator"
            value={proof.contracts.pactEvaluator}
            kind="address"
          />
          <DetailValue
            label="USDC"
            value={proof.contracts.usdc}
            kind="address"
          />
        </dl>
      </details>

      <details>
        <summary>Actors</summary>
        <dl>
          {Object.entries(proof.actors).map(([role, address]) => (
            <DetailValue
              key={role}
              label={role[0]!.toUpperCase() + role.slice(1)}
              value={address}
              kind="address"
            />
          ))}
        </dl>
      </details>

      <details>
        <summary>Objective condition</summary>
        <dl>
          <DetailValue label="Provider" value={proof.condition.provider} />
          <DetailValue label="Repository" value={proof.condition.repository} />
          <DetailValue
            label="Pull request"
            value={`#${proof.condition.pullRequest}`}
          />
          <DetailValue label="Base branch" value={proof.condition.baseBranch} />
          <DetailValue label="Event" value={proof.condition.event} />
          <DetailValue
            label="Condition hash"
            value={proof.conditionHash}
            kind="hash"
          />
        </dl>
      </details>

      <details>
        <summary>GitHub evidence</summary>
        <dl>
          <DetailValue
            label="Merge commit"
            value={proof.githubEvidence.mergeCommitSha}
            kind="hash"
          />
          <DetailValue
            label="Merged at"
            value={timestamp(proof.githubEvidence.mergedAt)}
          />
          <DetailValue
            label="Observed at"
            value={timestamp(proof.githubEvidence.observedAt)}
          />
          <DetailValue
            label="Evidence hash"
            value={proof.evidenceHash}
            kind="hash"
          />
        </dl>
      </details>

      <details>
        <summary>Signed verifier attestation</summary>
        <dl>
          <DetailValue
            label="Verifier"
            value={proof.attestation.verifier}
            kind="address"
          />
          <DetailValue
            label="Recovered signer"
            value={proof.attestation.recoveredSigner}
            kind="address"
          />
          <DetailValue
            label="EIP-712 digest"
            value={proof.attestation.digest}
            kind="hash"
          />
          <DetailValue
            label="Signature"
            value={proof.attestation.signature}
            kind="hash"
          />
          <DetailValue
            label="Valid until"
            value={timestamp(proof.attestation.validUntil)}
          />
        </dl>
      </details>

      <details>
        <summary>Settlement receipt</summary>
        <dl>
          <DetailValue
            label="Transaction"
            value={proof.relay.transactionHash}
            kind="hash"
          />
          <DetailValue label="Block" value={proof.relay.blockNumber} />
          <DetailValue
            label="Block hash"
            value={proof.relay.blockHash}
            kind="hash"
          />
          <DetailValue
            label="PactCompletionAccepted log"
            value={String(proof.relay.pactCompletionAcceptedLogIndex)}
          />
          <DetailValue
            label="JobCompleted log"
            value={String(proof.relay.jobCompletedLogIndex)}
          />
          <DetailValue
            label="Broadcast count"
            value={String(proof.relay.broadcastCount)}
          />
        </dl>
      </details>

      <details>
        <summary>Financial accounting</summary>
        <dl>
          <DetailValue label="Principal" value={proof.budget.display} />
          <DetailValue
            label="Provider payout"
            value={`${proof.settlement.providerPayout} base units`}
          />
          <DetailValue
            label="Treasury payout"
            value={`${proof.settlement.treasuryPayout} base units`}
          />
          <DetailValue
            label="Evaluator payout"
            value={`${proof.settlement.evaluatorPayout} base units`}
          />
          <DetailValue
            label="Residual allowance"
            value={`${proof.accounting.residualAllowance} base units`}
          />
          <DetailValue
            label="Gas accounting"
            value="Recorded separately in Arc native 18-decimal units"
          />
        </dl>
      </details>

      <details>
        <summary>Source / deployment provenance</summary>
        <dl>
          <DetailValue
            label="Proof source"
            value={proof.sourceProvenance.proofSourceCommit}
            kind="hash"
          />
          <DetailValue
            label="Deployment"
            value={proof.sourceProvenance.deploymentCommit}
            kind="hash"
          />
          <DetailValue
            label="Runtime"
            value={proof.sourceProvenance.runtimeCommit}
            kind="hash"
          />
          <DetailValue
            label="ERC-8183 source"
            value={proof.sourceProvenance.erc8183SourceCommit}
            kind="hash"
          />
          <DetailValue
            label="Evidence checkpoint"
            value={
              proof.sourceProvenance.certifiedEvidenceCheckpoint ??
              "Not separately captured"
            }
            kind={
              proof.sourceProvenance.certifiedEvidenceCheckpoint
                ? "hash"
                : "text"
            }
          />
        </dl>
      </details>
    </div>
  );
}

function RecoveryLineage({
  proof,
}: {
  readonly proof: SettlementProofArtifact;
}) {
  const lineage = proof.recovery;
  if (lineage === undefined) return null;
  return (
    <section className="proof-section" aria-labelledby="recovery-heading">
      <div className="proof-section-heading">
        <div>
          <p className="eyebrow">Immutable audit trail</p>
          <h2 id="recovery-heading">Recovery lineage</h2>
        </div>
        <span className="proof-read-only">One relay broadcast</span>
      </div>
      <ol className="proof-timeline">
        <li>
          <span className="proof-step-check" aria-hidden="true">
            ✓
          </span>
          <div className="proof-step-body">
            <div className="proof-step-title">
              <div>
                <span className="proof-step-kind">Expired attestation</span>
                <h3>Retired unsent</h3>
              </div>
              <span className="badge badge-verified">Zero capability</span>
            </div>
            <div className="proof-step-meta">
              <span>{lineage.historical.operationState}</span>
              <span>{lineage.historical.relayState}</span>
              <span>Broadcasts {lineage.historical.broadcastAttemptCount}</span>
            </div>
            <HashDisplay hash={lineage.historical.attestationDigest} />
          </div>
        </li>
        <li>
          <span className="proof-step-check" aria-hidden="true">
            ✓
          </span>
          <div className="proof-step-body">
            <div className="proof-step-title">
              <div>
                <span className="proof-step-kind">Fresh verification</span>
                <h3>Evidence regenerated</h3>
              </div>
              <span className="badge badge-verified">Verified</span>
            </div>
            <HashDisplay hash={lineage.recovery.evidenceHash} />
          </div>
        </li>
        <li>
          <span className="proof-step-check" aria-hidden="true">
            ✓
          </span>
          <div className="proof-step-body">
            <div className="proof-step-title">
              <div>
                <span className="proof-step-kind">Fresh attestation</span>
                <h3>Signed for relay</h3>
              </div>
              <span className="badge badge-verified">Fresh</span>
            </div>
            <HashDisplay hash={lineage.recovery.attestationDigest} />
          </div>
        </li>
        <li>
          <span className="proof-step-check" aria-hidden="true">
            ✓
          </span>
          <div className="proof-step-body">
            <div className="proof-step-title">
              <div>
                <span className="proof-step-kind">Relay settlement</span>
                <h3>One broadcast · completed</h3>
              </div>
              <span className="badge badge-verified">Final</span>
            </div>
            <div className="proof-step-meta">
              <span>
                Nonce {lineage.relayNonceBefore} → {lineage.relayNonceAfter}
              </span>
              <span>Broadcasts {proof.relay.broadcastCount}</span>
            </div>
            <ExplorerTransaction
              proof={proof}
              hash={proof.relay.transactionHash}
            />
          </div>
        </li>
      </ol>
    </section>
  );
}

export function ProofCenter({
  proof,
}: {
  readonly proof: SettlementProofArtifact;
}) {
  const isMainnet = proof.environment === "mainnet";
  return (
    <main className="page proof-center">
      <header className="proof-header">
        <div>
          <p className="eyebrow">Canonical settlement proof · Read only</p>
          <h1>Proof Center</h1>
          <p className="lede">
            {isMainnet
              ? "Live USDC settlement on Arc Mainnet."
              : "Hosted end-to-end product lifecycle on Arc Testnet."}
          </p>
          {isMainnet && (
            <p className="proof-read-only">
              Mainnet proofs:{" "}
              <Link href="/proof/arc-mainnet/job/1">Job #1</Link>
              {" · "}
              <Link href="/proof/arc-mainnet/job/2">Job #2</Link>
            </p>
          )}
        </div>
        <nav className="proof-network-switcher" aria-label="Proof network">
          <Link
            href="/proof?network=mainnet"
            aria-current={isMainnet ? "page" : undefined}
            className={isMainnet ? "active" : undefined}
          >
            Mainnet
          </Link>
          <Link
            href="/proof?network=testnet"
            aria-current={!isMainnet ? "page" : undefined}
            className={!isMainnet ? "active" : undefined}
          >
            Testnet
          </Link>
        </nav>
      </header>

      <section className="proof-outcome" aria-label="Proof outcome">
        <div className="proof-outcome-status">
          <span className="badge badge-verified">
            <span className="badge-dot" /> Completed
          </span>
          <NetworkBadge network={proof.network} chainId={proof.chainId} />
        </div>
        <h2>{proof.budget.display} settled to the provider</h2>
        <p>
          Job #{proof.job.id} settled after GitHub PR #
          {proof.condition.pullRequest} merged into{" "}
          <code>{proof.condition.baseBranch}</code>.
        </p>
        <div className="proof-key-facts">
          <div>
            <span>Condition</span>
            <strong>
              {proof.condition.repository}#{proof.condition.pullRequest}
            </strong>
          </div>
          <div>
            <span>Verified evidence</span>
            <HashDisplay hash={proof.evidenceHash} />
          </div>
          <div>
            <span>Settlement transaction</span>
            <ExplorerTransaction
              proof={proof}
              hash={proof.relay.transactionHash}
            />
          </div>
          <div>
            <span>Final payout</span>
            <strong>{proof.budget.display} · zero protocol fee</strong>
          </div>
        </div>
      </section>

      <section className="proof-section" aria-labelledby="lifecycle-heading">
        <div className="proof-section-heading">
          <div>
            <p className="eyebrow">Canonical sequence</p>
            <h2 id="lifecycle-heading">Settlement lifecycle</h2>
          </div>
          <span className="proof-read-only">Immutable artifact</span>
        </div>
        <ol className="proof-timeline">
          {proof.walletActions.map((action) => (
            <li key={action.action}>
              <span className="proof-step-check" aria-hidden="true">
                ✓
              </span>
              <div className="proof-step-body">
                <div className="proof-step-title">
                  <div>
                    <span className="proof-step-kind">Wallet action</span>
                    <h3>{action.label}</h3>
                  </div>
                  <span className="badge badge-verified">Success</span>
                </div>
                <div className="proof-step-meta">
                  <span>
                    {action.role === "CLIENT" ? "Client" : "Provider"}
                  </span>
                  <span>{action.method}</span>
                  <span>Block {action.blockNumber}</span>
                  <time dateTime={timestamp(action.timestamp)}>
                    {timestamp(action.timestamp)}
                  </time>
                </div>
                <ExplorerTransaction proof={proof} hash={action.txHash} />
              </div>
            </li>
          ))}
          <li>
            <span className="proof-step-check" aria-hidden="true">
              ✓
            </span>
            <div className="proof-step-body">
              <div className="proof-step-title">
                <div>
                  <span className="proof-step-kind">Pact verification</span>
                  <h3>Condition Verified</h3>
                </div>
                <span className="badge badge-verified">Signed</span>
              </div>
              <div className="proof-step-meta">
                <span>Independent GitHub API observation</span>
                <time dateTime={timestamp(proof.githubEvidence.observedAt)}>
                  {timestamp(proof.githubEvidence.observedAt)}
                </time>
              </div>
              <HashDisplay hash={proof.attestation.digest} truncate={false} />
            </div>
          </li>
          <li>
            <span className="proof-step-check" aria-hidden="true">
              ✓
            </span>
            <div className="proof-step-body">
              <div className="proof-step-title">
                <div>
                  <span className="proof-step-kind">Relay settlement</span>
                  <h3>Settlement Complete</h3>
                </div>
                <span className="badge badge-verified">Final</span>
              </div>
              <div className="proof-step-meta">
                <span>Relay · {proof.relay.method}</span>
                <span>Block {proof.relay.blockNumber}</span>
                <time dateTime={timestamp(proof.relay.timestamp)}>
                  {timestamp(proof.relay.timestamp)}
                </time>
              </div>
              <ExplorerTransaction
                proof={proof}
                hash={proof.relay.transactionHash}
              />
            </div>
          </li>
        </ol>
      </section>

      <RecoveryLineage proof={proof} />

      <section className="proof-section" aria-labelledby="details-heading">
        <div className="proof-section-heading">
          <div>
            <p className="eyebrow">Audit material</p>
            <h2 id="details-heading">Proof details</h2>
          </div>
        </div>
        <ProofDetails proof={proof} />
      </section>
    </main>
  );
}
