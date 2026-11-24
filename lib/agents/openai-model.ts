import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatMessage, ChatModel, ModelResponse, ToolDefinition } from "@/lib/agents/model";

const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 30_000;

function toOpenAiMessage(message: ChatMessage): ChatCompletionMessageParam {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
}

export class OpenAiChatModel implements ChatModel {
  readonly name: string;
  private readonly client: OpenAI;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.name = model;
    this.client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  }

  async complete({ messages, tools }: { messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<ModelResponse> {
    const response = await this.client.chat.completions.create({
      model: this.name,
      temperature: 0.2,
      messages: messages.map(toOpenAiMessage),
      tools: tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      // Every turn must be a tool call: the agent can only stop through a finish tool,
      // which is what makes its output structured and validatable.
      tool_choice: "required",
    });

    const message = response.choices[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? [])
        .filter((call) => call.type === "function")
        .map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments })),
    };
  }
}
