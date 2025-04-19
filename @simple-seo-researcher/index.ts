import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createSupervisor } from '@langchain/langgraph-supervisor';
import { createSerpKeywordsTool } from './tools/serp';
import { createLighthouseTool } from './tools/lighthouse';
import {
  createKeywordAgent,
  createAuditAgent,
  createSummaryAgent,
} from './agents';
import { Langfuse, CallbackHandler } from 'langfuse-langchain';

/* ----- */
/*                    Memory Persistence Setup                           */
/* ----- */
// For this proof of concept, use an in-memory store
import { InMemoryStore } from '@langchain/langgraph';
const store = new InMemoryStore();

/* ----- */
/*                              Logging Utility                               */
/* ----- */
interface LogData {
  agent?: string;
  tool?: string;
  result?: unknown;
  error?: Error;
}

const log = (message: string, data?: LogData): void => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.dir(data, { depth: null });
  }
};

/* ----- */
/*                              Main Function                                  */
/* ----- */
const analyzeSEO = async (url: string) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }
  if (!process.env.SCRAPINGDOG_API_KEY) {
    throw new Error('Missing SCRAPINGDOG_API_KEY environment variable');
  }
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('Missing GOOGLE_API_KEY environment variable');
  }
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    throw new Error('Missing LANGFUSE environment variables');
  }

  const model = new ChatOpenAI({
    modelName: 'gpt-4.1-mini',
    openAIApiKey: process.env.OPENAI_API_KEY,
  });

  const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });
  const rootTrace = langfuse.trace({ userId: 'seo-analysis' });
  const lfHandler = new CallbackHandler({ root: rootTrace });

  const serpTool = createSerpKeywordsTool(process.env.SCRAPINGDOG_API_KEY);
  const lighthouseTool = createLighthouseTool(process.env.GOOGLE_API_KEY);

  /* ----- */
  /*            Bind tools per-agent for specialized React agents            */
  /* ----- */
  // Bind only the serpTool for the keyword agent
  const keywordModel = model.bindTools([serpTool]);
  // Bind only the lighthouseTool for the audit agent
  const auditModel = model.bindTools([lighthouseTool]);

  const keywordAgent = await createKeywordAgent(keywordModel, serpTool);
  const auditAgent = await createAuditAgent(auditModel, lighthouseTool);
  // summaryAgent does not require any tools
  const summaryAgent = await createSummaryAgent(model);

  /* ----- */
  /*            Create the supervisor (no direct tools bound)             */
  /* ----- */
  const supervisor = createSupervisor({
    agents: [keywordAgent, auditAgent, summaryAgent],
    llm: model,
    prompt: new SystemMessage(`You supervise three agents:

1. keyword_expert  → run first, wait for its update.
2. audit_expert    → run second, wait for its update.
3. summary_writer  → run last to draft the final report.

Workflow:
- Invoke keyword_expert with the user URL, wait.
- Pass updated context to audit_expert, wait.
- Pass full context to summary_writer.
- When summary_writer replies with "FINISH", return that reply to the user and STOP.

Never loop or call an agent twice.`),
    outputMode: 'last_message',
    supervisorName: 'seo_researcher',
  });

  const app = supervisor.compile({ store }).withConfig({
    callbacks: [lfHandler],
    runName: 'seo-researcher-run',
    recursionLimit: 20,
  });

  const initialMessages = [
    new SystemMessage(`You are an SEO analysis system. Follow these steps in order:
      1. Use the keyword expert to:
         - Analyze current keyword rankings
         - Identify competitors
         - Wait for their results
      
      2. Use the audit expert to:
         - Run technical analysis
         - Wait for their results
      
      Important: Work with one agent at a time and wait for their results before proceeding.`),
    new HumanMessage(`Analyze ${url} and create an SEO analysis`),
  ];

  log('Starting SEO analysis');
  const result = await app.invoke({
    messages: initialMessages,
  });
  log('Analysis complete', { result });

  return {
    url,
    messages: initialMessages,
    result,
  };
};

/* ----- */
/*                              Run Analysis                                   */
/* ----- */
const main = async () => {
  try {
    const results = await analyzeSEO('happyhippobakery.com');
    console.log('Analysis complete:', results);
  } catch (error) {
    console.error('Error during analysis:', error);
  }
};

main();
