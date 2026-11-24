/**
 * Minimal chat-model abstraction the agent runtime talks to.
 * One real implementation (OpenAI) and one scripted implementation (mock mode / tests).
 */

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string exactly as produced by the model — parsed and validated by the runtime. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ModelResponse {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ChatModel {
  readonly name: string;
  complete(request: { messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<ModelResponse>;
}
