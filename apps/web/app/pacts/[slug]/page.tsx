import { PactDetail } from "../../../frontend/pact-detail";
import { WalletBoundary } from "../../../frontend/wallet-boundary";

export default async function PactPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main className="page">
      <WalletBoundary>
        <PactDetail slug={slug} />
      </WalletBoundary>
    </main>
  );
}
