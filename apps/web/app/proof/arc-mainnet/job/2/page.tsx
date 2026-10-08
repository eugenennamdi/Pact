import type { Metadata } from "next";
import { ProofCenter } from "../../../../../frontend/proof-center";
import { getMainnetProof } from "../../../../../proof/artifacts";

export const metadata: Metadata = {
  alternates: { canonical: "/proof/arc-mainnet/job/2" },
};

export default function MainnetProofPage() {
  return <ProofCenter proof={getMainnetProof("2")} />;
}
