import {
  getProductRuntime,
  handleCreateDraft,
} from "../../../../server/product-runtime";

export async function POST(request: Request): Promise<Response> {
  return handleCreateDraft(request, getProductRuntime());
}
