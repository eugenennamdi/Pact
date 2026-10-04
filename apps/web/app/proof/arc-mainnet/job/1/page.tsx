import mainnetManifest from "../../../../../../../deployments/arc-mainnet.json";
import { MainnetLiveConfirmation } from "../../../../../frontend/mainnet-live-confirmation";
import {
  AddressDisplay,
  HashDisplay,
} from "../../../../../frontend/presentation";

export default function MainnetProofPage() {
  const proof = mainnetManifest.mainnetGate;
  return (
    <main className="page">
      <div className="page-header">
        <p className="eyebrow">Certified Mainnet Proof · Read Only</p>
        <h1>Arc Mainnet Job #1</h1>
        <p className="lede">
          Cryptographic settlement record verified and settled on Arc Mainnet
          (Chain ID 5042). This page serves as an immutable reference proof for
          auditors and verifiers.
        </p>
      </div>

      <div className="notice" style={{ marginBottom: "2rem" }}>
        <h3 style={{ margin: "0 0 0.25rem 0" }}>Historical proof surface</h3>
        <p style={{ margin: 0 }}>
          This page represents an authoritative, completed Mainnet settlement
          record. It is read-only and does not accept interactive wallet
          connections, draft creation, or signing requests.
        </p>
      </div>

      <div className="grid">
        {/* SURFACE 1: CERTIFIED SNAPSHOT */}
        <section className="card" aria-labelledby="snapshot-heading">
          <div className="card-header">
            <div className="card-title-group">
              <h2 id="snapshot-heading">Certified snapshot</h2>
              <p className="card-description">
                Permanent manifest state certified under release{" "}
                {proof.mainnetReleaseCommit.slice(0, 7)}.
              </p>
            </div>
            <span className="badge badge-verified">
              <span className="badge-dot" />
              {proof.status}
            </span>
          </div>

          <dl>
            <dt>Certification status</dt>
            <dd>
              <strong>{proof.status}</strong>
            </dd>
            <dt>Certified timestamp</dt>
            <dd>{proof.completedAt}</dd>
            <dt>Target job</dt>
            <dd>Job #{proof.jobId}</dd>
            <dt>GitHub condition</dt>
            <dd>
              <strong>
                {proof.github.repository}#{proof.github.pullRequest}
              </strong>{" "}
              merged to <code>main</code>
            </dd>
            <dt>Settlement amount</dt>
            <dd>
              <strong>0.10 USDC</strong> (100,000 base units)
            </dd>
            <dt>Provider payout</dt>
            <dd>0.10 USDC</dd>
            <dt>Treasury payout</dt>
            <dd>0 USDC</dd>
            <dt>Evaluator payout</dt>
            <dd>0 USDC</dd>
            <dt>Settlement transaction</dt>
            <dd>
              <HashDisplay hash={proof.settlement.transactionHash} />
            </dd>
            <dt>Receipt block</dt>
            <dd>Block #{proof.settlement.receiptBlockNumber}</dd>
            <dt>Receipt block hash</dt>
            <dd>
              <HashDisplay hash={proof.settlement.receiptBlockHash} />
            </dd>
            <dt>Evidence hash</dt>
            <dd>
              <HashDisplay hash={proof.evidenceHash} />
            </dd>
            <dt>Final job status</dt>
            <dd>Status {proof.finalState.jobStatus} (Completed)</dd>
            <dt>Binding accepted</dt>
            <dd>{proof.finalState.bindingAccepted ? "Yes" : "No"}</dd>
            <dt>Relay broadcast attempts</dt>
            <dd>1 broadcast attempt</dd>
            <dt>ERC-8183 implementation</dt>
            <dd>
              <AddressDisplay address={proof.contracts.implementation} />
            </dd>
            <dt>ERC-1967 proxy</dt>
            <dd>
              <AddressDisplay address={proof.contracts.proxy} />
            </dd>
            <dt>PactEvaluator contract</dt>
            <dd>
              <AddressDisplay address={proof.contracts.pactEvaluator} />
            </dd>
          </dl>

          <p
            style={{
              marginTop: "1.25rem",
              marginBottom: 0,
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: "0.75rem",
            }}
          >
            Explorer source verification is unavailable on Arc Mainnet and is
            not claimed.
          </p>
        </section>

        {/* SURFACE 2: LIVE RPC CONFIRMATION */}
        <MainnetLiveConfirmation
          transactionHash={proof.settlement.transactionHash}
          expectedBlockHash={proof.settlement.receiptBlockHash}
          expectedBlockNumber={proof.settlement.receiptBlockNumber}
        />
      </div>
    </main>
  );
}
