import {
  getProductRuntime,
  handlePrepareWalletAction,
} from "../../../../../../../../server/product-runtime";

export async function POST(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly slug: string;
      readonly action: string;
    }>;
  },
): Promise<Response> {
  const { slug, action } = await context.params;
  return handlePrepareWalletAction(request, getProductRuntime(), slug, action);
}
