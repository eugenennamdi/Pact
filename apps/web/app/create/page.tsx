import { CreatePact } from "../../frontend/create-pact";

export default function CreatePage() {
  return (
    <main className="page">
      <div className="page-header">
        <p className="eyebrow">Interactive Arc Testnet Execution</p>
        <h1>Create Pact</h1>
        <p className="lede">
          Connect and authenticate the client wallet. Pact validates an open
          public GitHub pull request and enforces protocol deadlines onchain.
        </p>
      </div>
      <CreatePact />
    </main>
  );
}
