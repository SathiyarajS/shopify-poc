import {
  ClarifyIssue,
  FilterSpec,
  OpSpec,
  OpSpecSchema,
  PlanClarify,
  PlanRequest,
  PlanResponse,
  PlanSuccess,
  PlanSuccessSchema,
  PlanClarifySchema,
  PlanResponseSchema,
  emptyFilterSpec,
} from "./schemas";

const WORDS_TO_STRIP = [
  "please",
  "all",
  "products",
  "product",
  "items",
  "item",
  "the",
  "to",
  "for",
  "of",
  "with",
  "and",
  "that",
  "my",
];

const FILTER_STRIP_REGEX = new RegExp(`\\b(${WORDS_TO_STRIP.join("|")})\\b`, "gi");

const CURRENCY_SYMBOLS = ["$", "€", "£", "₹", "¥", "₤", "₱", "₦", "₽"];

function normalize(text: string): string {
  return text.trim();
}

function extractPercentage(text: string): number | null {
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function extractCurrencyValue(text: string): number | null {
  const symbolPattern = `[${CURRENCY_SYMBOLS.map((s) => `\\${s}`).join("")}]`; // escape symbols
  const regex = new RegExp(`${symbolPattern}?\s*(-?\d+(?:\.\d+)?)`);
  const match = text.match(regex);
  if (!match) return null;
  return parseFloat(match[1]);
}

function extractPlainNumber(text: string): number | null {
  const match = text.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

function buildFilterSpec(text: string, usedSegments: string[] = []): FilterSpec {
  let cleaned = text;
  for (const segment of usedSegments) {
    if (!segment) continue;
    const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(escaped, "ig"), " ");
  }

  cleaned = cleaned
    .replace(/"([^"]+)"|'([^']+)'/g, " ") // remove quoted tags
    .replace(/\d+(?:\.\d+)?%?/g, " ")
    .replace(FILTER_STRIP_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();

  const filter = emptyFilterSpec();
  filter.titleContains = cleaned.length >= 3 ? cleaned : null;
  return filter;
}

function parseTags(text: string): string[] {
  const quotedMatches = Array.from(text.matchAll(/"([^"]+)"|'([^']+)'/g));
  if (quotedMatches.length > 0) {
    return quotedMatches
      .map((match) => match[1] || match[2])
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  const afterTag = text.split(/tags?/i)[1];
  if (!afterTag) return [];
  return afterTag
    .split(/[,&]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function deriveStatus(text: string): "ACTIVE" | "DRAFT" | "ARCHIVED" | null {
  if (/publish|activate/i.test(text)) return "ACTIVE";
  if (/unpublish|draft/i.test(text)) return "DRAFT";
  if (/archive|archived?/i.test(text)) return "ARCHIVED";
  return null;
}

function detectLocation(text: string): string | null {
  const match = text.match(/(?:location|at|in)\s+(?:location\s+)?([\w\s-]+)/i);
  if (!match) return null;
  return match[1].trim();
}

function buildPricePlan(text: string): PlanSuccess | PlanClarify {
  const lower = text.toLowerCase();
  const filterSpec = buildFilterSpec(text, ["price", "prices"]);

  let mode: "inc_percent" | "inc_value" | "set" | null = null;
  let value: number | null = null;
  let summaryKey: string | undefined;

  if (/increase|raise/.test(lower)) {
    const percent = extractPercentage(text);
    if (percent !== null) {
      mode = "inc_percent";
      value = Math.abs(percent);
      summaryKey = "plan.summary.priceIncreasePercent";
    } else {
      const amount = extractCurrencyValue(text) ?? extractPlainNumber(text);
      if (amount !== null) {
        mode = "inc_value";
        value = Math.abs(amount);
        summaryKey = "plan.summary.priceIncreaseValue";
      }
    }
  } else if (/decrease|reduce|lower/.test(lower)) {
    const percent = extractPercentage(text);
    if (percent !== null) {
      mode = "inc_percent";
      value = -Math.abs(percent);
      summaryKey = "plan.summary.priceDecreasePercent";
    } else {
      const amount = extractCurrencyValue(text) ?? extractPlainNumber(text);
      if (amount !== null) {
        mode = "inc_value";
        value = -Math.abs(amount);
        summaryKey = "plan.summary.priceDecreaseValue";
      }
    }
  } else if (/set|change/.test(lower) && /price/.test(lower)) {
    const amount = extractCurrencyValue(text) ?? extractPlainNumber(text);
    if (amount !== null) {
      mode = "set";
      value = amount;
      summaryKey = "plan.summary.priceSet";
    }
  }

  if (!mode || value === null) {
    const issues: ClarifyIssue[] = [
      {
        code: "plan.missingAmount",
        messageKey: "plan.clarify.missingAmount",
      },
    ];
    return PlanClarifySchema.parse({ action: "clarify", issues });
  }

  const opSpec: OpSpec = {
    operation: "price",
    scope: "product",
    params: {
      mode,
      value,
    },
  };

  return PlanSuccessSchema.parse({
    action: "plan",
    opSpec,
    filterSpec,
    confidence: "medium",
    summaryKey,
  });
}

function buildTagsPlan(text: string): PlanSuccess | PlanClarify {
  const lower = text.toLowerCase();
  const filterSpec = buildFilterSpec(text, ["tag", "tags"]);
  const tags = parseTags(text);

  if (tags.length === 0) {
    return PlanClarifySchema.parse({
      action: "clarify",
      issues: [
        {
          code: "plan.missingTagValues",
          messageKey: "plan.clarify.missingTags",
        },
      ],
    });
  }

  let mode: "add" | "remove" | "replace" = "add";
  if (/replace/.test(lower)) {
    mode = "replace";
  } else if (/remove|delete/.test(lower)) {
    mode = "remove";
  }

  const opSpec: OpSpec = {
    operation: "tags",
    scope: "product",
    params: {
      mode,
      values: tags,
    },
  };

  return PlanSuccessSchema.parse({
    action: "plan",
    opSpec,
    filterSpec,
    confidence: "medium",
    summaryKey: mode === "add" ? "plan.summary.tagsAdd" : mode === "remove" ? "plan.summary.tagsRemove" : "plan.summary.tagsReplace",
  });
}

function buildInventoryPlan(text: string): PlanSuccess | PlanClarify {
  const lower = text.toLowerCase();
  const number = extractPlainNumber(text);
  const location = detectLocation(text);
  let mode: "set" | "inc" | "dec" = "set";
  if (/increase|add|plus/.test(lower)) mode = "inc";
  if (/decrease|remove|minus|deduct/.test(lower)) mode = "dec";

  const filterSpec = buildFilterSpec(text, ["inventory", "stock", location ?? ""]);

  const draftOp =
    number !== null
      ? OpSpecSchema.parse({
          operation: "inventory",
          scope: "variant",
          params: {
            mode,
            value: Math.abs(number),
            locationId: location ?? undefined,
          },
        })
      : undefined;

  const issues: ClarifyIssue[] = [];
  if (number === null) {
    issues.push({ code: "plan.missingAmount", messageKey: "plan.clarify.missingAmount" });
  }
  if (!location) {
    issues.push({ code: "inventory.requireLocation", messageKey: "plan.clarify.requireLocation" });
  }
  if (issues.length > 0) {
    return PlanClarifySchema.parse({
      action: "clarify",
      issues,
      draft: draftOp
        ? {
            opSpec: draftOp as OpSpec,
            filterSpec,
            confidence: "low",
          }
        : undefined,
    });
  }

  const opSpec: OpSpec = {
    operation: "inventory",
    scope: "variant",
    params: {
      mode,
      value: Math.abs(number!),
      locationId: location,
    },
  };

  return PlanSuccessSchema.parse({
    action: "plan",
    opSpec,
    filterSpec,
    confidence: "medium",
    summaryKey: "plan.summary.inventoryAdjust",
  });
}

function buildStatusPlan(text: string): PlanSuccess | PlanClarify {
  const status = deriveStatus(text);
  if (!status) {
    return PlanClarifySchema.parse({
      action: "clarify",
      issues: [
        {
          code: "plan.unsupported",
          messageKey: "plan.clarify.unsupportedStatus",
        },
      ],
    });
  }

  const filterSpec = buildFilterSpec(text, ["publish", "unpublish", "archive", "status"]);

  const opSpec: OpSpec = {
    operation: "status",
    scope: "product",
    params: { status },
  };

  return PlanSuccessSchema.parse({
    action: "plan",
    opSpec,
    filterSpec,
    confidence: "medium",
    summaryKey: "plan.summary.statusChange",
  });
}

export function planFromRequest(request: PlanRequest): PlanResponse {
  const original = normalize(request.text);
  const lower = original.toLowerCase();

  let response: PlanResponse | null = null;

  if (/price/.test(lower)) {
    response = buildPricePlan(original);
  } else if (/tag/.test(lower)) {
    response = buildTagsPlan(original);
  } else if (/inventory|stock|quantity/.test(lower)) {
    response = buildInventoryPlan(original);
  } else if (/publish|unpublish|archive|draft/i.test(original)) {
    response = buildStatusPlan(original);
  }

  if (!response) {
    return PlanClarifySchema.parse({
      action: "clarify",
      issues: [
        {
          code: "plan.unrecognized",
          messageKey: "plan.clarify.unrecognized",
        },
      ],
    });
  }

  return PlanResponseSchema.parse(response);
}
