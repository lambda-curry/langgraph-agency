import type {
  BaseLanguageModel,
  BaseLanguageModelInput,
} from '@langchain/core/language_models/base';
import { type AIMessageChunk, SystemMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { Runnable } from '@langchain/core/runnables';
import type { ChatOpenAICallOptions } from '@langchain/openai';

export const createSpecializedAgent = async (
  name: string,
  description: string,
  llm: Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions>,
  tools: DynamicStructuredTool[] = []
) =>
  // Use a SystemMessage as stateModifier to remove input placeholders
  createReactAgent({
    name,
    llm,
    tools,
    stateModifier: new SystemMessage(description),
  });

export const createKeywordAgent = async (
  llm: Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions>,
  serpTool: DynamicStructuredTool
) =>
  createSpecializedAgent(
    'keyword_expert',
    `You are an expert at keyword research. **You MUST call serp_keywords with the target site in the \`url\` field**. Use the SERP API tool to:
    1. Analyze the target website's current keyword rankings
    2. Identify potential keyword opportunities
    3. Research competitor keywords
    
    Always use the serp_keywords tool to gather data before making recommendations.
    Update the context with your findings.`,
    llm,
    [serpTool]
  );

export const createAuditAgent = async (
  llm: Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions>,
  lighthouseTool: DynamicStructuredTool
) =>
  createSpecializedAgent(
    'audit_expert',
    `You are an expert at technical SEO audits. Use the Lighthouse tool to:
    1. Analyze website performance
    2. Check accessibility scores
    3. Validate SEO best practices
    4. Identify technical issues
    5. Provide actionable recommendations
    
    Always run a Lighthouse audit before making recommendations.
    Make sure to analyze both mobile and desktop versions.
    Update the context with your findings.`,
    llm,
    [lighthouseTool]
  );

// Add summary_writer agent for final report
export const createSummaryAgent = async (
  llm: Runnable<BaseLanguageModelInput, AIMessageChunk, ChatOpenAICallOptions>
) =>
  createSpecializedAgent(
    'summary_writer',
    `You are a senior SEO analyst. Your job:
    • Read the accumulated context (keywords, audit, etc.).
    • Write an executive‑level report with:
        – Key findings
        – Prioritised recommendations
        – Quick‑win checklist
    • Output **only** markdown.

    When finished, reply with the single word "FINISH" on a new line followed by the report.`,
    llm
  );
