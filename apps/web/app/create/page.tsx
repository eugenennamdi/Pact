import { CreatePact } from "../../frontend/create-pact";
import { WalletBoundary } from "../../frontend/wallet-boundary";

export default function CreatePage() {
  return (
    <main className="page">
      <p className="eyebrow">Interactive Arc Testnet product</p>
      <h1>Create Pact</h1>
      <p>
        Connect and authenticate the client wallet. Pact validates an open
        public GitHub pull request and owns all protocol policy fields.
      </p>
      <WalletBoundary>
        <CreatePact />
      </WalletBoundary>
    </main>
  );
}
