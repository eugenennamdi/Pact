import type { Metadata } from "next";
import { ProofCenter } from "../../frontend/proof-center";
import { getSettlementProof } from "../../proof/artifacts";

export const metadata: Metadata = {
  alternates: { canonical: "/proof" },
};

export default async function ProofPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly network?: string | string[] }>;
}) {
  const params = await searchParams;
  const network = Array.isArray(params.network)
    ? params.network[0]
    : params.network;
  return <ProofCenter proof={getSettlementProof(network)} />;
}
