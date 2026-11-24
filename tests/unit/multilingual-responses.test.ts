import { describe, expect, it, vi } from "vitest";

import { answerQuestion } from "@/lib/coach/answer";
import { consentFrom } from "@/lib/coach/consent";
import type { SessionContext } from "@/lib/coach/context";
import { runTool } from "@/lib/coach/registry";
import type { Env } from "@/lib/env";

const { generateText } = vi.hoisted(() => ({
  generateText: vi.fn<
    (options: {
      system: string;
      messages: { role: string; content: string }[];
      tools: {
        get_spending: {
          execute: (input: { target: "taxi"; period: "last_month" }) => Promise<unknown>;
        };
      };
    }) => Promise<{ text: string; usage: object }>
  >(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText,
}));

vi.mock("@/lib/admin/settings", () => ({
  getSettings: async () => ({ features: { ai: true }, aiDailyRequestLimit: 0 }),
  recordAiUsage: async () => undefined,
}));

vi.mock("@/lib/env", () => ({
  getEnv: () =>
    ({
      AI_PROCESSING_ALLOWED: true,
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      CHAT_MAX_TOOL_STEPS: 4,
      CHAT_TIMEOUT_MS: 1000,
    }) satisfies Partial<Env>,
}));

const ctx: SessionContext = {
  customerRef: "test",
  consent: consentFrom(null),
  locale: "sv",
  asOf: "2026-09-15",
  benchmarks: [],
  record: {
    profile: { customerId: "TEST1", accountId: "ACC1", age: 40, postalCode: "00100" },
    transactions: [
      {
        row: 1,
        date: "2026-08-15",
        time: "12:00:00",
        amountCents: -4_000,
        balanceCents: 50_000,
        category: "Transportation",
        type: "purchase",
        merchantId: null,
        mcc: "4121",
      },
    ],
  },
};

const input = { target: "taxi", period: "last_month" } as const;

describe("multilingual coach responses", () => {
  it.each([
    ["English", "How much did I spend on taxis last month?", "You spent €40 on taxis last month."],
    ["Chinese", "上个月我打车花了多少钱？", "你上个月打车花了40欧元。"],
    [
      "French",
      "Combien ai-je dépensé en taxi le mois dernier ?",
      "Vous avez dépensé 40 € en taxi.",
    ],
  ])(
    "passes the %s question to the model and preserves transaction evidence",
    async (_, question, text) => {
      const expected = runTool(ctx, "spending", input);
      generateText.mockImplementationOnce(async ({ tools }) => {
        await tools.get_spending.execute(input);
        return { text, usage: {} };
      });

      const { message } = await answerQuestion(ctx, question, [
        { role: "assistant", text: "Hur kan jag hjälpa dig?" },
      ]);

      const call = generateText.mock.lastCall?.[0];
      expect(call?.system).toContain("Identify the language of the latest user question");
      expect(call?.system).toContain("English, Chinese, French");
      expect(call?.messages.at(-1)).toEqual({ role: "user", content: question });
      expect(message).toMatchObject({
        mode: "ai",
        text,
        card: expected.card,
        facts: expected.facts,
        query: expected.query,
        evidence: expected.evidence,
      });
      expect(message.evidence).toMatchObject({ transactionCount: 1, mccs: ["4121"] });
    },
  );
});
