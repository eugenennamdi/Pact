import { redirect } from "next/navigation";

export default function MainnetProofPage() {
  redirect("/proof?network=mainnet");
}
