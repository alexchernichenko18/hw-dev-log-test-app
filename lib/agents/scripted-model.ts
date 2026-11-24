import type { ChatMessage, ChatModel, ModelResponse, ToolCall } from "@/lib/agents/model";

/** What a scripted policy sees: the tool results received so far, by tool name, in order. */
export interface ScriptContext {
  input: string;
  results: { name: string; args: unknown; result: unknown }[];
  /** Most recent result of a given tool, parsed. */
  last<T = unknown>(name: string): T | undefined;
}

export type ScriptPolicy = (context: ScriptContext) => { thought?: string; calls: { name: string; args: unknown }[] };

function buildContext(messages: ChatMessage[]): ScriptContext {
  const input = messages.find((m) => m.role === "user")?.content ?? "";
  const callsById = new Map<string, ToolCall>();
  for (const message of messages) {
    if (message.role === "assistant") message.toolCalls.forEach((call) => callsById.set(call.id, call));
  }
  const results = messages
    .filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool")
    .map((m) => {
      const call = callsById.get(m.toolCallId);
      return {
        name: call?.name ?? "",
        args: call ? JSON.parse(call.arguments || "{}") : {},
        result: JSON.parse(m.content),
      };
    });
  return {
    input,
    results,
    last<T>(name: string) {
      return results.filter((r) => r.name === name).at(-1)?.result as T | undefined;
    },
  };
}

/**
 * A deterministic stand-in for the LLM. It drives the *same* runtime and the *same* tools,
 * so mock mode exercises the real loop, validation and UI — only the decisions are heuristic.
 */
export class ScriptedChatModel implements ChatModel {
  readonly name = "mock (no OPENAI_API_KEY)";
  private counter = 0;

  constructor(private readonly policy: ScriptPolicy) {}

  async complete({ messages }: { messages: ChatMessage[] }): Promise<ModelResponse> {
    const { thought, calls } = this.policy(buildContext(messages));
    return {
      content: thought ?? null,
      toolCalls: calls.map((call) => ({
        id: `mock_${++this.counter}`,
        name: call.name,
        arguments: JSON.stringify(call.args),
      })),
    };
  }
}
