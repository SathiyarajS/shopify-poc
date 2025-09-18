import type { Env } from "../_utils/env";
import { PlanRequestSchema, PlanResponseSchema } from "../../shared/planning/schemas";
import { planFromRequest } from "../../shared/planning/parser";

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    ...init,
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  try {
    const payload = await request.json();
    const parsed = PlanRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return json({
        action: "error",
        code: "plan.invalid_request",
        message: parsed.error.flatten(),
      }, { status: 400 });
    }

    const response = planFromRequest(parsed.data);
    return json(PlanResponseSchema.parse(response));
  } catch (error) {
    console.error("/api/plan failed", error);
    return json({ action: "error", code: "plan.failed", message: (error as Error).message }, { status: 500 });
  }
};
