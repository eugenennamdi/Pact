import mainnetManifest from "../../../../../../../deployments/arc-mainnet.json";
import { MainnetLiveConfirmation } from "../../../../../frontend/mainnet-live-confirmation";

export default function MainnetProofPage() {
  const proof = mainnetManifest.mainnetGate;
  return (
    <main className="page">
      <p className="eyebrow">Certified Mainnet proof · read only</p>
      <h1>Arc Mainnet job 1</h1>
      <p className="notice">
        This page is a certified historical proof. It is not an interactive
        Mainnet Pact creation or signing surface.
      </p>
      <section className="card" aria-labelledby="snapshot-heading">
        <h2 id="snapshot-heading">Certified snapshot</h2>
        <dl>
          <dt>Certification</dt>
          <dd>{proof.status}</dd>
          <dt>Certified at</dt>
          <dd>{proof.completedAt}</dd>
          <dt>ERC-8183 implementation</dt>
          <dd className="hash">{proof.contracts.implementation}</dd>
          <dt>ERC-8183 proxy</dt>
          <dd className="hash">{proof.contracts.proxy}</dd>
          <dt>PactEvaluator</dt>
          <dd className="hash">{proof.contracts.pactEvaluator}</dd>
          <dt>Job</dt>
          <dd>{proof.jobId}</dd>
          <dt>GitHub PR</dt>
          <dd>
            {proof.github.repository}#{proof.github.pullRequest}
          </dd>
          <dt>Settlement transaction</dt>
          <dd className="hash">{proof.settlement.transactionHash}</dd>
          <dt>Evidence hash</dt>
          <dd className="hash">{proof.evidenceHash}</dd>
          <dt>Final job status</dt>
          <dd>{proof.finalState.jobStatus}</dd>
          <dt>Binding accepted</dt>
          <dd>{proof.finalState.bindingAccepted ? "Yes" : "No"}</dd>
        </dl>
        <p>Explorer source verification is unavailable and is not claimed.</p>
      </section>
      <MainnetLiveConfirmation
        transactionHash={proof.settlement.transactionHash}
        expectedBlockHash={proof.settlement.receiptBlockHash}
        expectedBlockNumber={proof.settlement.receiptBlockNumber}
      />
    </main>
  );
}
