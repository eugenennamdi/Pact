import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <main className="page">
      <section className="landing-hero" aria-labelledby="hero-title">
        <h1 id="hero-title">
          Objective outcomes, turned into ERC-8183 settlement decisions.
        </h1>
        <p className="lede">
          Lock USDC against a GitHub pull-request merge. Pact independently
          verifies the outcome, produces signed evidence, and settles the
          ERC-8183 job on Arc.
        </p>
        <div className="actions">
          <Link className="button-link" href="/proof/arc-mainnet/job/2">
            View live Mainnet proof
          </Link>
          <a
            className="button-link secondary"
            href="https://github.com/eugenennamdi/Pact"
            target="_blank"
            rel="noreferrer"
          >
            View source
          </a>
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
            Job #2 · GitHub PR #7 · 0.01 USDC · Completed via one relay
            broadcast on Arc Mainnet (Chain ID 5042).
          </p>
        </div>
        <Link className="button-link secondary" href="/proof/arc-mainnet/job/2">
          View live Mainnet proof
        </Link>
      </section>
    </main>
  );
}
