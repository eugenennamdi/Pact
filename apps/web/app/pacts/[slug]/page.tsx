import { PactDetail } from "../../../frontend/pact-detail";

export default async function PactPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  return (
    <main className="page">
      <PactDetail slug={slug} />
    </main>
  );
}
