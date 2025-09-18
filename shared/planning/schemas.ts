import { z } from "zod";

export const RoundSchema = z.object({
  precision: z.number().positive().max(1),
  endWith: z.string().optional(),
  mode: z.enum(["nearest", "up", "down"]).default("nearest"),
});

export const MetafieldSpecSchema = z.object({
  ns: z.string().min(1),
  key: z.string().min(1),
  type: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const SEOSpecSchema = z.object({
  title: z.string().max(70).nullable().optional(),
  description: z.string().max(320).nullable().optional(),
});

const BaseOpSpecSchema = z.object({
  scope: z.enum(["product", "variant"]).default("product"),
  schedule: z.string().datetime().nullable().optional(),
});

const PriceParamsSchema = z.object({
  mode: z.enum(["inc_percent", "inc_value", "set"]),
  value: z.number(),
  currency: z.string().length(3).optional(),
  round: RoundSchema.optional(),
});

const TagsParamsSchema = z.object({
  mode: z.enum(["add", "remove", "replace"]),
  values: z.array(z.string().min(1)).min(1),
});

const InventoryParamsSchema = z.object({
  mode: z.enum(["set", "inc", "dec"]),
  value: z.number().int(),
  locationId: z.string().min(1).optional(),
});

const StatusParamsSchema = z.object({
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]),
});

const PriceOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("price"),
  params: PriceParamsSchema,
});

const CompareAtOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("compare_at"),
  params: PriceParamsSchema,
});

const TagsOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("tags"),
  params: TagsParamsSchema,
});

const InventoryOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("inventory"),
  params: InventoryParamsSchema,
});

const StatusOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("status"),
  params: StatusParamsSchema,
});

const MetafieldOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("metafield"),
  params: z.object({
    metafield: MetafieldSpecSchema,
  }),
});

const SeoOpSpecSchema = BaseOpSpecSchema.extend({
  operation: z.literal("seo"),
  params: z.object({
    seo: SEOSpecSchema,
  }),
});

export const OpSpecSchema = z.discriminatedUnion("operation", [
  PriceOpSpecSchema,
  CompareAtOpSpecSchema,
  TagsOpSpecSchema,
  InventoryOpSpecSchema,
  StatusOpSpecSchema,
  MetafieldOpSpecSchema,
  SeoOpSpecSchema,
]);

export type OpSpec = z.infer<typeof OpSpecSchema>;

export const FilterMustSchema = z.object({
  vendors: z.array(z.string()).default([]),
  types: z.array(z.string()).default([]),
  collections: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const FilterMustNotSchema = z.object({
  tags: z.array(z.string()).default([]),
});

export const FilterNumericSchema = z.object({
  priceGte: z.number().nullable().optional(),
  priceLte: z.number().nullable().optional(),
  inventoryEq: z.number().nullable().optional(),
});

export const FilterSpecSchema = z.object({
  must: FilterMustSchema.default({ vendors: [], types: [], collections: [], tags: [] }),
  mustNot: FilterMustNotSchema.default({ tags: [] }),
  titleContains: z.string().nullable().optional(),
  numeric: FilterNumericSchema.default({}),
});

export type FilterSpec = z.infer<typeof FilterSpecSchema>;

export const ClarifyCodeSchema = z.enum([
  "inventory.requireLocation",
  "plan.unrecognized",
  "plan.unsupported",
  "plan.missingAmount",
  "plan.missingTagValues",
]);

export type ClarifyCode = z.infer<typeof ClarifyCodeSchema>;

export const ClarifyOptionSchema = z.object({
  value: z.string(),
  labelKey: z.string(),
});

export const ClarifyIssueSchema = z.object({
  code: ClarifyCodeSchema,
  messageKey: z.string(),
  options: z.array(ClarifyOptionSchema).optional(),
});

export type ClarifyIssue = z.infer<typeof ClarifyIssueSchema>;

export const PlanSuccessSchema = z.object({
  action: z.literal("plan"),
  opSpec: OpSpecSchema,
  filterSpec: FilterSpecSchema,
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  summaryKey: z.string().optional(),
});

export type PlanSuccess = z.infer<typeof PlanSuccessSchema>;

export const PlanClarifySchema = z.object({
  action: z.literal("clarify"),
  issues: z.array(ClarifyIssueSchema).nonempty(),
  draft: PlanSuccessSchema.partial().optional(),
});

export type PlanClarify = z.infer<typeof PlanClarifySchema>;

export const PlanErrorSchema = z.object({
  action: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export type PlanError = z.infer<typeof PlanErrorSchema>;

export const PlanResponseSchema = z.union([
  PlanSuccessSchema,
  PlanClarifySchema,
  PlanErrorSchema,
]);

export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const PlanRequestSchema = z.object({
  text: z.string().min(1),
  locale: z.string().optional(),
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export function emptyFilterSpec(): FilterSpec {
  return {
    must: { vendors: [], types: [], collections: [], tags: [] },
    mustNot: { tags: [] },
    titleContains: null,
    numeric: {},
  };
}
