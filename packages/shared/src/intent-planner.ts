export type BuyerIntentPlan = {
  category?: string;
  keywords: string[];
  budgetCeilingPaise: number;
  priority: "value" | "quality" | "balanced";
  rationale: string;
  source: "model" | "deterministic";
};

const CATEGORIES = ["headphones", "keyboards", "mice", "monitors", "webcams", "smartwatches"] as const;

function inferCategory(text: string): string | undefined {
  const normalized = text.toLowerCase();
  return CATEGORIES.find((category) => normalized.includes(category) || normalized.includes(category.slice(0, -1)));
}

function deterministicPlan(request: string, maxSpendPaise: number): BuyerIntentPlan {
  const normalized = request.toLowerCase();
  const priority = normalized.includes("cheap") || normalized.includes("budget") || normalized.includes("lowest")
    ? "value"
    : normalized.includes("best") || normalized.includes("premium") || normalized.includes("top")
      ? "quality"
      : "balanced";
  const keywords = normalized.split(/[^a-z0-9]+/).filter((word) => word.length >= 4).slice(0, 8);
  const category = inferCategory(request);
  return {
    category,
    keywords,
    budgetCeilingPaise: maxSpendPaise,
    priority,
    rationale: category ? `Interpreted the request as a ${category} purchase with a ${priority} preference under the supplied hard budget.` : `Interpreted the request with a ${priority} preference under the supplied hard budget.`,
    source: "deterministic",
  };
}

function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function modelPlan(request: string, maxSpendPaise: number): Promise<BuyerIntentPlan | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model) return null;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Convert buyer intent into a constrained shopping plan. Never increase or invent the supplied budget. Return JSON with category, keywords, priority (value|quality|balanced), rationale." },
        { role: "user", content: JSON.stringify({ request, hardBudgetPaise: maxSpendPaise, allowedCategories: CATEGORIES }) },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) return null;
  const json = extractJson(content);
  if (!json) return null;
  const rawCategory = typeof json.category === "string" ? json.category.trim().toLowerCase() : "";
  const category = CATEGORIES.includes(rawCategory as typeof CATEGORIES[number]) ? rawCategory : inferCategory(request);
  const priority = json.priority === "value" || json.priority === "quality" || json.priority === "balanced" ? json.priority : "balanced";
  const keywords = Array.isArray(json.keywords) ? json.keywords.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];
  const rationale = typeof json.rationale === "string" && json.rationale.trim() ? json.rationale.trim() : "Model-produced constrained intent plan.";
  return { category, keywords, budgetCeilingPaise: maxSpendPaise, priority, rationale, source: "model" };
}

export async function planBuyerIntent(request: string, maxSpendPaise: number): Promise<BuyerIntentPlan> {
  if (!Number.isSafeInteger(maxSpendPaise) || maxSpendPaise <= 0) throw new Error("INVALID_BUYER_BUDGET");
  try {
    const planned = await modelPlan(request, maxSpendPaise);
    if (planned) return planned;
  } catch {
    // Fall back to the deterministic planner if the model provider is unavailable.
  }
  return deterministicPlan(request, maxSpendPaise);
}
