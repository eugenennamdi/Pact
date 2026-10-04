import Link from "next/link";

export default function Home() {
  return (
    <main className="page landing">
      <p className="eyebrow">Interactive Arc Testnet product</p>
      <h1>Programmable settlement for objectively verifiable outcomes.</h1>
      <p className="lede">
        Pact currently verifies one condition: whether a specified GitHub pull
        request has merged into its expected base branch.
      </p>
      <div className="actions">
        <Link className="button-link" href="/create">
          Create Pact
        </Link>
        <Link className="button-link secondary" href="/proof/arc-mainnet/job/1">
          View Mainnet proof
        </Link>
      </div>
      <section className="card" aria-labelledby="sequence-heading">
        <h2 id="sequence-heading">How it works</h2>
        <ol className="sequence">
          <li>Fund</li>
          <li>Work</li>
          <li>Verify outcome</li>
          <li>Settle</li>
        </ol>
      </section>
    </main>
  );
}
