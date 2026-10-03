import {
  getProductRuntime,
  handleAuthLogout,
  handleAuthSession,
} from "../../../../../server/product-runtime";

export async function POST(request: Request): Promise<Response> {
  return handleAuthSession(request, getProductRuntime());
}

export function DELETE(request: Request): Response {
  return handleAuthLogout(request, getProductRuntime());
}
