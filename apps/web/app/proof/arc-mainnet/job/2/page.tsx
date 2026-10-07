import { ProofCenter } from "../../../../../frontend/proof-center";
import { getMainnetProof } from "../../../../../proof/artifacts";

export default function MainnetProofPage() {
  return <ProofCenter proof={getMainnetProof("2")} />;
}
