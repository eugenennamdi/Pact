import type { Metadata } from "next";
import { CreatePact } from "../../frontend/create-pact";

export const metadata: Metadata = {
  alternates: { canonical: "/create" },
};

export default function CreatePage() {
  return (
    <main className="page">
      <div className="page-header">
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
