import Link from "next/link";

export default function Home() {
  return (
    <main className="page">
      <section className="landing-hero" aria-labelledby="hero-title">
        <h1 id="hero-title">
          Programmable settlement for verifiable outcomes.
        </h1>
        <p className="lede">
          Pact locks USDC in ERC-8183 escrow and settles automatically when an
          independently verified condition is satisfied onchain.
        </p>
        <div className="actions">
          <Link className="button-link" href="/create">
            Create a Pact
          </Link>
          <Link className="button-link secondary" href="/proof">
            View Mainnet proof
          </Link>
        </div>
      </section>

      <section
        aria-labelledby="sequence-heading"
        style={{ margin: "3.5rem 0" }}
      >
        <p className="eyebrow">Protocol lifecycle</p>
        <h2 id="sequence-heading">How Pact settles</h2>
        <div className="how-it-works-grid">
          <div className="how-it-works-step">
            <span className="step-number">01</span>
            <h3 className="step-title">Define & Lock</h3>
            <p className="step-desc">
              Client specifies the PR merge condition and locks USDC into the
              ERC-8183 escrow contract on Arc.
            </p>
          </div>
          <div className="how-it-works-step">
            <span className="step-number">02</span>
            <h3 className="step-title">Deliver Work</h3>
            <p className="step-desc">
              Provider opens or updates the pull request against the target
              repository and confirms submission.
            </p>
          </div>
          <div className="how-it-works-step">
            <span className="step-number">03</span>
            <h3 className="step-title">Verify Outcome</h3>
            <p className="step-desc">
              Pact independently queries GitHub authoritative state and signs a
              cryptographic EIP-712 attestation.
            </p>
          </div>
          <div className="how-it-works-step">
            <span className="step-number">04</span>
            <h3 className="step-title">Settle Escrow</h3>
            <p className="step-desc">
              Relayer broadcasts the attestation to PactEvaluator, executing
              ERC-8183 completion and releasing payout.
            </p>
          </div>
        </div>
      </section>

      <section className="condition-card" aria-labelledby="condition-heading">
        <div className="condition-header">
          <div>
            <p className="eyebrow" style={{ marginBottom: "0.25rem" }}>
              Integration specification
            </p>
            <h2 id="condition-heading" style={{ margin: 0 }}>
              Supported condition: GitHub PR merged
            </h2>
          </div>
        </div>
        <p style={{ maxWidth: "44rem", marginBottom: "1.5rem" }}>
          Pact validates that a specific pull request has merged into its target
          base branch. Verification is positive-only: Pact never rejects a job
          merely because a condition is currently false or pending.
        </p>
        <dl>
          <dt>Condition schema</dt>
          <dd>GitHub PR_MERGED V1</dd>
          <dt>Evaluation trigger</dt>
          <dd>Authoritative merge commit on target branch</dd>
          <dt>Cryptographic artifact</dt>
          <dd>EIP-712 signed Attestation V2</dd>
          <dt>Evaluator contract</dt>
          <dd>PactEvaluator.sol (ERC-8183 compatible)</dd>
        </dl>
      </section>

      <section
        className="proof-callout-card"
        aria-labelledby="proof-callout-heading"
      >
        <div>
          <p
            className="eyebrow"
            style={{ color: "var(--accent-verified)", marginBottom: "0.25rem" }}
          >
            Authoritative proof
          </p>
          <h2 id="proof-callout-heading" style={{ margin: "0 0 0.5rem 0" }}>
            Real Arc Mainnet settlement
          </h2>
          <p style={{ margin: 0 }}>
            Job #1 · 0.10 USDC · Completed via single relay broadcast on Arc
            Mainnet (Chain ID 5042).
          </p>
        </div>
        <Link className="button-link secondary" href="/proof">
          Inspect Mainnet proof
        </Link>
      </section>
    </main>
  );
}
