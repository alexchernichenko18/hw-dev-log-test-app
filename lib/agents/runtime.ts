import { z } from "zod";
import type { ChatMessage, ChatModel, ToolCall, ToolDefinition } from "@/lib/agents/model";

/** A tool the agent uses to gather context or act. Its result goes back to the model. */
export interface AgentTool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run: (input: I) => unknown;
  /** One-line, human-readable summary of what happened — shown in the UI trace. */
  summarize?: (input: I, output: unknown) => string;
}

/**
 * A tool that ends the run. Its arguments ARE the agent's structured output.
 * `check` performs semantic validation the schema can't express (e.g. "every taskId exists").
 * Returned problems are sent back to the model so it can correct itself.
 */
export interface FinishTool<O = unknown> {
  name: string;
  description: string;
  output: z.ZodType<O>;
  check?: (output: O) => string[];
}

type Executed = { ok: true; output: unknown; summary: string } | { ok: false; error: string; summary: string };
type Validated = { ok: true; value: unknown } | { ok: false; error: string };

/** A tool with its input type erased, so tools with different inputs can live in one list. */
export interface RegisteredTool {
  definition: ToolDefinition;
  execute: (rawArguments: string) => Executed;
}

/** A finish tool with its output type erased. */
export interface RegisteredFinishTool {
  definition: ToolDefinition;
  validate: (rawArguments: string) => Validated;
}

export function defineTool<I>(tool: AgentTool<I>): RegisteredTool {
  return {
    definition: toDefinition(tool.name, tool.description, tool.input),
    execute(rawArguments) {
      let args: unknown;
      try {
        args = parseArguments(rawArguments);
      } catch {
        return { ok: false, error: "Arguments must be valid JSON.", summary: "Arguments were not valid JSON" };
      }
      const parsed = tool.input.safeParse(args);
      if (!parsed.success) {
        return { ok: false, error: `Invalid arguments: ${formatIssues(parsed.error)}`, summary: "Invalid arguments" };
      }
      try {
        const output = tool.run(parsed.data);
        return { ok: true, output, summary: tool.summarize?.(parsed.data, output) ?? `Called ${tool.name}` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), summary: "Tool failed" };
      }
    },
  };
}

export function defineFinishTool<O>(tool: FinishTool<O>): RegisteredFinishTool {
  return {
    definition: toDefinition(tool.name, tool.description, tool.output),
    validate(rawArguments) {
      let args: unknown;
      try {
        args = parseArguments(rawArguments);
      } catch {
        return { ok: false, error: "arguments were not valid JSON" };
      }
      const parsed = tool.output.safeParse(args);
      if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
      const problems = tool.check?.(parsed.data) ?? [];
      if (problems.length > 0) return { ok: false, error: problems.join("; ") };
      return { ok: true, value: parsed.data };
    },
  };
}

export interface TraceStep {
  step: number;
  tool: string;
  summary: string;
  /** Free-text reasoning the model emitted alongside the tool call, if any. */
  thought?: string;
  error?: string;
}

export interface AgentRunResult<K extends string = string> {
  finish: { tool: K; output: unknown };
  trace: TraceStep[];
  steps: number;
  model: string;
}

export type AgentErrorCode = "model_unavailable" | "step_limit" | "invalid_output";

export class AgentError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
    readonly trace: TraceStep[] = [],
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export interface AgentConfig<K extends string> {
  name: string;
  system: string;
  input: string;
  tools: RegisteredTool[];
  finishTools: Record<K, RegisteredFinishTool>;
  model: ChatModel;
  /** Hard cap on model turns. Each turn may contain several tool calls. */
  maxSteps?: number;
  /** How many times a rejected final answer may be retried before giving up. */
  maxRepairs?: number;
}

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_REPAIRS = 2;
const MAX_TOOL_RESULT_CHARS = 12_000;

function toDefinition(name: string, description: string, schema: z.ZodType): ToolDefinition {
  const parameters = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete parameters.$schema;
  return { name, description, parameters };
}

function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function serialize(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)` : json;
}

/**
 * Generic tool-calling loop:
 *   model turn → execute requested tools → feed results back → repeat,
 * until the model calls one of the finish tools with output that passes validation,
 * or the step budget runs out.
 */
export async function runAgent<K extends string>(config: AgentConfig<K>): Promise<AgentRunResult<K>> {
  const maxSteps = config.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxRepairs = config.maxRepairs ?? DEFAULT_MAX_REPAIRS;
  const tools = new Map(config.tools.map((tool) => [tool.definition.name, tool]));
  const finishTools = new Map<string, RegisteredFinishTool>(Object.values<RegisteredFinishTool>(config.finishTools).map((tool) => [tool.definition.name, tool]));
  const definitions = [...tools.values(), ...finishTools.values()].map((tool) => tool.definition);

  const messages: ChatMessage[] = [
    { role: "system", content: config.system },
    { role: "user", content: config.input },
  ];
  const trace: TraceStep[] = [];
  let repairs = 0;

  for (let step = 1; step <= maxSteps; step++) {
    let response;
    try {
      response = await config.model.complete({ messages, tools: definitions });
    } catch (error) {
      console.error(`[agent:${config.name}] model call failed`, error);
      throw new AgentError("model_unavailable", "The AI model could not be reached. Try again in a moment.", trace);
    }

    const thought = response.content?.trim() || undefined;
    messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });

    if (response.toolCalls.length === 0) {
      // The model answered in prose instead of calling a tool — nudge it back to the protocol.
      trace.push({ step, tool: "(none)", summary: "Model replied without calling a tool", thought });
      messages.push({
        role: "user",
        content: `Reply by calling one of the tools. To finish, call ${[...finishTools.keys()].join(" or ")}.`,
      });
      continue;
    }

    for (const call of response.toolCalls) {
      const finishTool = finishTools.get(call.name);
      if (finishTool) {
        const outcome = finishTool.validate(call.arguments);
        if (outcome.ok) {
          trace.push({ step, tool: call.name, summary: "Returned the final answer", thought });
          return { finish: { tool: call.name as K, output: outcome.value }, trace, steps: step, model: config.model.name };
        }
        repairs++;
        trace.push({ step, tool: call.name, summary: "Final answer rejected by validation", thought, error: outcome.error });
        if (repairs > maxRepairs) {
          throw new AgentError("invalid_output", `The agent kept returning invalid output: ${outcome.error}`, trace);
        }
        messages.push(toolResult(call, { error: `Output rejected: ${outcome.error}. Fix it and call ${call.name} again.` }));
        continue;
      }

      const tool = tools.get(call.name);
      if (!tool) {
        trace.push({ step, tool: call.name, summary: "Unknown tool", thought, error: "unknown_tool" });
        messages.push(toolResult(call, { error: `Unknown tool "${call.name}".` }));
        continue;
      }
      const executed = tool.execute(call.arguments);
      trace.push({ step, tool: call.name, summary: executed.summary, thought, ...(executed.ok ? {} : { error: executed.error }) });
      messages.push(toolResult(call, executed.ok ? executed.output : { error: executed.error }));
    }
  }

  throw new AgentError("step_limit", `The agent did not finish within ${maxSteps} steps.`, trace);
}

function toolResult(call: ToolCall, value: unknown): ChatMessage {
  return { role: "tool", toolCallId: call.id, content: serialize(value) };
}
