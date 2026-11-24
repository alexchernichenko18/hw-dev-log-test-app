import type { ChatModel } from "@/lib/agents/model";
import { OpenAiChatModel } from "@/lib/agents/openai-model";
import { ScriptedChatModel, type ScriptPolicy } from "@/lib/agents/scripted-model";

export function isMockMode(): boolean {
  return !process.env.OPENAI_API_KEY;
}

/**
 * Real OpenAI model when a key is configured, otherwise the agent's deterministic script.
 * Each agent supplies its own mock policy so mock mode still produces meaningful output.
 */
export function createModel(mockPolicy: ScriptPolicy): ChatModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return new ScriptedChatModel(mockPolicy);
  return new OpenAiChatModel(apiKey, process.env.OPENAI_MODEL || undefined);
}
