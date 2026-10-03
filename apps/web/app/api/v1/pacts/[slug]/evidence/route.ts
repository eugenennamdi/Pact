import {
  getProductRuntime,
  handleReadEvidence,
} from "../../../../../../server/product-runtime";

export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  return handleReadEvidence(request, getProductRuntime(), slug);
}
