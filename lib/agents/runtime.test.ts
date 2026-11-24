import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ChatMessage, ChatModel, ModelResponse } from "@/lib/agents/model";
import { AgentError, defineFinishTool, defineTool, runAgent } from "@/lib/agents/runtime";

/** Fake model that replays a fixed list of responses and records what it was sent. */
function fakeModel(responses: ModelResponse[]): ChatModel & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  let index = 0;
  return {
    name: "fake",
    seen,
    async complete({ messages }) {
      seen.push(structuredClone(messages));
      const response = responses[index++];
      if (!response) throw new Error("fake model ran out of responses");
      return response;
    },
  };
}

const call = (name: string, args: unknown, id = name) => ({
  content: null,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

const lookup = defineTool({
  name: "lookup",
  description: "Look up a number",
  input: z.object({ id: z.number().int() }),
  run: ({ id }) => ({ id, doubled: id * 2 }),
  summarize: ({ id }) => `Looked up ${id}`,
});

const answer = defineFinishTool({
  name: "answer",
  description: "Final answer",
  output: z.object({ value: z.number() }),
  check: ({ value }) => (value < 0 ? ["value must not be negative"] : []),
});

function config(model: ChatModel, overrides = {}) {
  return {
    name: "test",
    system: "system",
    input: "input",
    tools: [lookup],
    finishTools: { answer },
    model,
    ...overrides,
  };
}

describe("runAgent", () => {
  it("runs tools, feeds results back and stops on the finish tool", async () => {
    const model = fakeModel([call("lookup", { id: 21 }), call("answer", { value: 42 })]);
    const result = await runAgent(config(model));

    expect(result.finish).toEqual({ tool: "answer", output: { value: 42 } });
    expect(result.steps).toBe(2);
    expect(result.trace.map((t) => t.summary)).toEqual(["Looked up 21", "Returned the final answer"]);

    const toolMessage = model.seen[1].find((m) => m.role === "tool");
    expect(toolMessage).toMatchObject({ content: JSON.stringify({ id: 21, doubled: 42 }) });
  });

  it("returns schema errors for tool arguments to the model instead of crashing", async () => {
    const model = fakeModel([call("lookup", { id: "x" }), call("answer", { value: 1 })]);
    const result = await runAgent(config(model));

    expect(result.trace[0]).toMatchObject({ tool: "lookup", summary: "Invalid arguments" });
    const toolMessage = model.seen[1].find((m) => m.role === "tool");
    expect(toolMessage && "content" in toolMessage && toolMessage.content).toContain("Invalid arguments");
  });

  it("rejects a final answer that fails semantic checks and lets the model repair it", async () => {
    const model = fakeModel([call("answer", { value: -1 }, "a1"), call("answer", { value: 5 }, "a2")]);
    const result = await runAgent(config(model));

    expect(result.finish.output).toEqual({ value: 5 });
    expect(result.trace[0]).toMatchObject({ error: "value must not be negative" });
  });

  it("gives up with invalid_output after too many rejected answers", async () => {
    const model = fakeModel([
      call("answer", { value: -1 }, "a1"),
      call("answer", { value: -2 }, "a2"),
    ]);
    await expect(runAgent(config(model, { maxRepairs: 1 }))).rejects.toMatchObject({
      code: "invalid_output",
    });
  });

  it("stops with step_limit when the model never finishes", async () => {
    const model = fakeModel(Array.from({ length: 3 }, (_, i) => call("lookup", { id: i }, `l${i}`)));
    const error = await runAgent(config(model, { maxSteps: 3 })).catch((e) => e);

    expect(error).toBeInstanceOf(AgentError);
    expect(error.code).toBe("step_limit");
    expect(error.trace).toHaveLength(3);
  });

  it("nudges the model when it answers in prose", async () => {
    const model = fakeModel([{ content: "I think 42", toolCalls: [] }, call("answer", { value: 42 })]);
    const result = await runAgent(config(model));

    expect(result.finish.output).toEqual({ value: 42 });
    expect(model.seen[1].at(-1)).toMatchObject({ role: "user" });
  });

  it("maps model failures to model_unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const model: ChatModel = {
      name: "broken",
      complete: async () => {
        throw new Error("ECONNRESET");
      },
    };
    await expect(runAgent(config(model))).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("reports unknown tools back to the model", async () => {
    const model = fakeModel([call("delete_everything", {}), call("answer", { value: 0 })]);
    const result = await runAgent(config(model));
    expect(result.trace[0]).toMatchObject({ tool: "delete_everything", error: "unknown_tool" });
  });
});
