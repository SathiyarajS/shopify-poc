import type { ActionFunctionArgs } from "@remix-run/node";
import { getShopify } from "../shopify.server";
import { getDatabase } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { authenticate } = getShopify();
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    if (session) {
        const db = getDatabase();
        await db.session.update({   
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};
