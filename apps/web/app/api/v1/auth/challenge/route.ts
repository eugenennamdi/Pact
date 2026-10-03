import {
  getProductRuntime,
  handleAuthChallenge,
} from "../../../../../server/product-runtime";

export async function POST(request: Request): Promise<Response> {
  return handleAuthChallenge(request, getProductRuntime());
}
