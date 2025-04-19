// seo-agency.ts — "deluxe" edition
// A maximalist LangGraph demonstration that throws *every* Supervisor pattern

import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { Langfuse, CallbackHandler } from 'langfuse-langchain';
import { z } from 'zod';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
// fetch is available natively in Bun and modern Node runtimes
import { createSupervisor } from '@langchain/langgraph-supervisor';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { BaseMessage } from '@langchain/core/messages';
import type { AgentStep } from '@langchain/core/agents';
import type { AnnotationRoot } from '@langchain/langgraph';

/* -------------------------------------------------------------------------- */
/*                               Setup & Types                                */
/* -------------------------------------------------------------------------- */
const openaiApiKey = process.env.OPENAI_API_KEY;
const scrapingdogApiKey = process.env.SCRAPINGDOG_API_KEY;
const googleApiKey = process.env.GOOGLE_API_KEY;
const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
const langfuseBaseUrl = process.env.LANGFUSE_BASE_URL;

if (!openaiApiKey) {
  throw new Error('Missing OPENAI_API_KEY environment variable');
}

if (!scrapingdogApiKey) {
  throw new Error('Missing SCRAPINGDOG_API_KEY environment variable');
}

if (!googleApiKey) {
  throw new Error('Missing GOOGLE_API_KEY environment variable');
}

if (!langfusePublicKey || !langfuseSecretKey) {
  throw new Error('Missing LANGFUSE environment variables');
}

// Initialize Langfuse once
const langfuse = new Langfuse({
  publicKey: langfusePublicKey,
  secretKey: langfuseSecretKey,
  baseUrl: langfuseBaseUrl,
});

const model = new ChatOpenAI({
  modelName: 'gpt-4.1-mini',
  openAIApiKey: openaiApiKey,
});

interface GoogleSearchResult {
  organic_data: Array<{
    title: string;
    displayed_link: string;
    snippet: string;
    link: string;
    extended_sitelinks?: Array<{
      title: string;
      link: string;
    }>;
    rank: number;
  }>;
  people_also_ask?: Array<{
    question: string;
    id: string;
    rank: number;
    answers: string;
  }>;
}

interface LighthouseResponse {
  captchaResult: string;
  kind: string;
  id: string;
  loadingExperience: {
    metrics: {
      FIRST_CONTENTFUL_PAINT_MS: {
        percentile: number;
        category: string;
      };
      FIRST_INPUT_DELAY_MS: {
        percentile: number;
        category: string;
      };
    };
    overall_category: string;
  };
  lighthouseResult: {
    requestedUrl: string;
    finalUrl: string;
    categories: {
      performance?: { score: number };
      accessibility?: { score: number };
      'best-practices'?: { score: number };
      seo?: { score: number };
      pwa?: { score: number };
    };
    audits: Record<
      string,
      {
        id: string;
        title: string;
        description: string;
        score: number;
        displayValue?: string;
      }
    >;
  };
}

export interface Ctx {
  url: string;
  /* data buckets */
  keywords?: string[];
  competitors?: string[];
  clusters?: Record<string, string[]>; // topic → kw list
  audit?: unknown;
  strategy?: string;
  tasks?: string[];
  /* misc */
  log: string[];
}

/* -------------------------------------------------------------------------- */
/*                                Tool calls                                  */
/* -------------------------------------------------------------------------- */

// Define the tool input types
interface SerpKeywordsInput {
  url: string;
  query?: string;
  country?: string;
  language?: string;
}

interface LighthouseInput {
  url: string;
  strategy?: 'mobile' | 'desktop';
  categories?: Array<
    'performance' | 'accessibility' | 'best-practices' | 'seo' | 'pwa'
  >;
  locale?: string;
}

// Update tools to use DynamicStructuredTool
const serpKeywordsTool = new DynamicStructuredTool({
  name: 'serp_keywords',
  description: 'Get keywords and search results from Google SERP API',
  schema: z.object({
    url: z.string().url(),
    query: z.string().optional(),
    country: z.string().optional(),
    language: z.string().optional(),
  }),
  func: async ({
    url,
    query = '',
    country = 'us',
    language = 'en',
  }: SerpKeywordsInput) => {
    // always build the query from the url; let `query` override if supplied
    const searchQuery = query || `site:${url}`;

    const apiUrl = new URL('http://api.scrapingdog.com/google');
    apiUrl.searchParams.append('api_key', scrapingdogApiKey);
    apiUrl.searchParams.append('query', searchQuery);
    apiUrl.searchParams.append('country', country);
    apiUrl.searchParams.append('language', language);

    const response = await fetch(apiUrl.toString());
    if (!response.ok) {
      throw new Error(`SERP API request failed: ${response.statusText}`);
    }

    const data = (await response.json()) as GoogleSearchResult;

    // Extract keywords from titles and snippets
    const keywords = new Set<string>();
    for (const result of data.organic_data) {
      const text = `${result.title} ${result.snippet}`.toLowerCase();
      // Basic keyword extraction - can be enhanced with NLP
      const words = text
        .split(/\W+/)
        .filter(
          (word) => word.length > 3 && !['https', 'www', 'com'].includes(word)
        );
      for (const word of words) {
        keywords.add(word);
      }
    }

    return new Command({
      update: {
        keywords: Array.from(keywords),
        searchResults: data.organic_data,
        relatedQuestions: data.people_also_ask || [],
      },
    });
  },
});

const lighthouseTool = new DynamicStructuredTool({
  name: 'lighthouse',
  description: 'Run Lighthouse audit using Google PageSpeed Insights API',
  schema: z.object({
    url: z.string().url(),
    strategy: z.enum(['mobile', 'desktop']).optional(),
    categories: z
      .array(
        z.enum(['performance', 'accessibility', 'best-practices', 'seo', 'pwa'])
      )
      .optional(),
    locale: z.string().optional(),
  }),
  func: async ({
    url,
    strategy = 'mobile',
    categories = ['performance', 'accessibility', 'seo'],
    locale = 'en',
  }: LighthouseInput) => {
    const apiUrl = new URL(
      'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
    );
    apiUrl.searchParams.append('url', url);
    apiUrl.searchParams.append('key', googleApiKey);
    apiUrl.searchParams.append('strategy', strategy);
    for (const category of categories) {
      apiUrl.searchParams.append('category', category);
    }
    apiUrl.searchParams.append('locale', locale);

    const response = await fetch(apiUrl.toString());
    if (!response.ok) {
      throw new Error(`Lighthouse API request failed: ${response.statusText}`);
    }

    const data = (await response.json()) as LighthouseResponse;

    const result = {
      url: data.id,
      loadingExperience: {
        firstContentfulPaint:
          data.loadingExperience?.metrics?.FIRST_CONTENTFUL_PAINT_MS
            ?.category || 'N/A',
        firstInputDelay:
          data.loadingExperience?.metrics?.FIRST_INPUT_DELAY_MS?.category ||
          'N/A',
        overallCategory: data.loadingExperience?.overall_category || 'N/A',
      },
      scores: {
        performance: data.lighthouseResult?.categories?.performance?.score || 0,
        accessibility:
          data.lighthouseResult?.categories?.accessibility?.score || 0,
        bestPractices:
          data.lighthouseResult?.categories?.['best-practices']?.score || 0,
        seo: data.lighthouseResult?.categories?.seo?.score || 0,
        pwa: data.lighthouseResult?.categories?.pwa?.score || 0,
      },
      audits: Object.entries(data.lighthouseResult?.audits || {})
        .filter(([_, audit]) => audit.score !== null && audit.score < 1)
        .map(([id, audit]) => ({
          id,
          title: audit.title,
          description: audit.description,
          score: audit.score,
          displayValue: audit.displayValue,
        }))
        .sort((a, b) => a.score - b.score),
    };

    return new Command({
      update: {
        audit: result,
      },
    });
  },
});

/* -------------------------------------------------------------------------- */
/*                                  Agents                                    */
/* -------------------------------------------------------------------------- */
// Create specialized agents for each task
const createSpecializedAgent = async (
  name: string,
  description: string,
  tools: DynamicStructuredTool[] = []
) => {
  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(description),
    new HumanMessage('{input}'),
  ]);

  return createReactAgent({
    llm: model as BaseLanguageModel,
    tools,
    prompt,
    name,
  });
};

const keywordAgent = await createSpecializedAgent(
  'keyword_expert',
  `You are an expert at keyword research. **You MUST call serp_keywords with the target site in the \`url\` field**. Use the SERP API tool to:
	1. Analyze the target website's current keyword rankings
	2. Identify potential keyword opportunities
	3. Research competitor keywords
	4. Group keywords into relevant clusters
	
	Always use the serp_keywords tool to gather data before making recommendations.
	Update the context with your findings.`,
  [serpKeywordsTool]
);

const competitorAgent = await createSpecializedAgent(
  'competitor_expert',
  'You are an expert at competitor analysis. Identify top competitors in the space. Always leverage the serp_keywords tool for data.',
  [serpKeywordsTool]
);

const clusterAgent = await createSpecializedAgent(
  'cluster_expert',
  'You are an expert at organizing keywords into topical clusters.'
);

const personaAgent = await createSpecializedAgent(
  'persona_expert',
  'You are an expert at identifying target personas and their needs.'
);

const auditAgent = await createSpecializedAgent(
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
  [lighthouseTool]
);

const strategyAgent = await createSpecializedAgent(
  'strategy_expert',
  'You are an expert at crafting SEO strategies based on research data.'
);

const planningAgent = await createSpecializedAgent(
  'planning_expert',
  'You are an expert at breaking down strategies into actionable tasks.'
);

/* -------------------------------------------------------------------------- */
/*                               Supervisors                                  */
/* -------------------------------------------------------------------------- */
// 1. Research supervisor: handles keyword and competitor research
const researchSupervisor = createSupervisor<AgentState>({
  agents: [keywordAgent, competitorAgent],
  llm: model as BaseLanguageModel,
  prompt: `You manage keyword research and competitor analysis. Your process should be:
	1. Use the keyword agent to analyze current rankings and opportunities
	2. Identify main competitors from the keyword data
	3. Use the competitor agent to analyze their strategies
	4. Compile findings into actionable insights
	
	Always ensure tools are used to gather data before making recommendations.`,
  outputMode: 'last_message',
  supervisorName: 'research_supervisor',
});

// 2. Ideation supervisor: manages clustering and persona development
const ideationSupervisor = createSupervisor<AgentState>({
  agents: [clusterAgent, personaAgent],
  llm: model as BaseLanguageModel,
  prompt: `You manage keyword clustering and persona development. Your process should be:
	1. Take the keyword research from the research team
	2. Use the cluster agent to group keywords by topic and intent
	3. Use the persona agent to identify target audiences
	4. Create content recommendations based on clusters and personas
	
	Ensure recommendations are data-driven and actionable.`,
  outputMode: 'last_message',
  supervisorName: 'ideation_supervisor',
});

// 3. Audit supervisor: manages technical analysis
const auditSupervisor = createSupervisor<AgentState>({
  agents: [auditAgent],
  llm: model as BaseLanguageModel,
  prompt: `You manage technical SEO audits. Your process should be:
	1. Use the audit agent to run Lighthouse analysis for both mobile and desktop
	2. Analyze performance, accessibility, and SEO scores
	3. Identify critical issues and opportunities
	4. Prioritize recommendations based on impact and effort
	
	Always ensure recommendations are specific and actionable.`,
  outputMode: 'last_message',
  supervisorName: 'audit_supervisor',
});

// 4. Strategy supervisor: coordinates all research and planning
const strategySupervisor = createSupervisor<AgentState>({
  agents: [strategyAgent, planningAgent],
  llm: model as BaseLanguageModel,
  prompt: `You coordinate strategy development and task planning. Your process should be:
	1. Review findings from research, ideation, and audit teams
	2. Use the strategy agent to develop comprehensive recommendations
	3. Use the planning agent to create specific, actionable tasks
	4. Prioritize tasks based on impact and effort
	
	Ensure all recommendations are backed by data and tool findings.`,
  outputMode: 'last_message',
  supervisorName: 'strategy_supervisor',
});

/* -------------------------------------------------------------------------- */
/*                           Top‑level Agency                                 */
/* -------------------------------------------------------------------------- */
// Main supervisor that orchestrates the entire workflow
const seoAgency = createSupervisor<AgentState>({
  agents: [
    researchSupervisor.compile({ name: 'research_team' }),
    ideationSupervisor.compile({ name: 'ideation_team' }),
    auditSupervisor.compile({ name: 'audit_team' }),
    strategySupervisor.compile({ name: 'strategy_team' }),
  ],
  llm: model as BaseLanguageModel,
  prompt: `You are the head of an SEO agency. Your process for analyzing a website should be:
	1. Start with the research team to gather keyword and competitor data
	2. Send findings to the ideation team for clustering and persona development
	3. Parallel track: Have the audit team perform technical analysis
	4. Combine all findings with the strategy team to create actionable plans
	
	Ensure all recommendations are based on actual tool data and findings.
	Coordinate between teams to create a comprehensive strategy.`,
  outputMode: 'full_history',
  supervisorName: 'seo_agency',
});

/* -------------------------------------------------------------------------- */
/*                              Logging Utility                                 */
/* -------------------------------------------------------------------------- */
interface LogData {
  agent?: string;
  tool?: string;
  result?: unknown;
  error?: Error;
}

function log(message: string, data?: LogData): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) {
    console.dir(data, { depth: null });
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Demo                                     */
/* -------------------------------------------------------------------------- */
async function main() {
  const ctx: Ctx = {
    url: 'https://lambdacurry.dev',
    log: [],
    keywords: [],
    competitors: [],
    clusters: {},
    tasks: [],
  };

  log(`Starting SEO analysis for: ${ctx.url}`);

  // Create root trace and handler
  const rootTrace = langfuse.trace({ userId: 'seo-analysis' });
  const lfHandler = new CallbackHandler({ root: rootTrace });

  // Compile and configure with Langfuse handler
  const app = seoAgency.compile().withConfig({
    callbacks: [lfHandler],
    runName: 'seo-agency-run',
    recursionLimit: 100,
  });

  const result = await app.invoke({
    input: `Analyze ${ctx.url} and create an SEO strategy`,
    messages: [
      new SystemMessage(`You are an SEO analysis system. Follow these steps in order:
1. Use the research team to:
   - Analyze current keyword rankings
   - Identify competitors
   - Wait for their results

2. Use the ideation team to:
   - Group keywords into topics
   - Define target personas
   - Wait for their results

3. Use the audit team to:
   - Run technical analysis
   - Wait for their results

4. Use the strategy team to:
   - Review all findings
   - Create final recommendations

Important: Work with one team at a time and wait for their results before proceeding.`),
      new HumanMessage(`Analyze ${ctx.url} and create an SEO strategy`),
    ],
  });

  log('Analysis complete', { result });
  return result;
}

main().catch(console.error);

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
interface AgentState extends AnnotationRoot<any> {
  messages: BaseMessage[];
  steps: AgentStep[];
  lc_graph_name: string;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  State: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  Update: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  Node: any;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  spec: any;
}
