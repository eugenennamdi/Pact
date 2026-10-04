import {
  getProductRuntime,
  handleRetryPact,
} from "../../../../../../server/product-runtime";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  return handleRetryPact(request, getProductRuntime(), slug);
}
