import type { LoaderFunctionArgs } from "@remix-run/node";
import { getShopify } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { authenticate } = getShopify();
  await authenticate.admin(request);

  return null;
};
