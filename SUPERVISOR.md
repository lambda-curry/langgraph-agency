# @langchain/langgraph-supervisor

**Version:** 0.0.11 • **License:** MIT • **Published:** 8 days ago

A JavaScript/TypeScript library for creating hierarchical multi-agent systems using LangGraph. A supervisor agent orchestrates specialized agents, controlling communication flow and task delegation based on context and requirements.

---

## 📦 Installation

```bash
bun add @langchain/langgraph-supervisor @langchain/langgraph @langchain/core @langchain/openai
```

## ⚙️ Features

- **Supervisor Agent**: Orchestrate multiple specialized agents in a single workflow.
- **Tool-based Handoff**: Seamless handoff between agents using @langchain/core tools.
- **Flexible History**: Control message history granularity for conversations (full history or last message).
- **Streaming & Memory**: Built‑in support for streaming, short‑term and long‑term memory, and human‑in‑the‑loop.
- **Hierarchical Workflows**: Nest supervisors to build multi‑level hierarchies of agents.

---

## 🚀 Quickstart

```ts
import { ChatOpenAI } from "@langchain/openai";
import { createSupervisor } from "@langchain/langgraph-supervisor";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Initialize LLM
const model = new ChatOpenAI({ modelName: "gpt-4o" });

// Define simple tools
const add = tool(async (args) => args.a + args.b, {
  name: "add",
  description: "Add two numbers.",
  schema: z.object({ a: z.number(), b: z.number() }),
});

const multiply = tool(async (args) => args.a * args.b, {
  name: "multiply",
  description: "Multiply two numbers.",
  schema: z.object({ a: z.number(), b: z.number() }),
});

const webSearch = tool(async (args) => {
  // Example stub for web search
  return `Results for ${args.query}`;
}, {
  name: "web_search",
  description: "Search the web for information.",
  schema: z.object({ query: z.string() }),
});

// Create specialized agents
const mathAgent = createReactAgent({ llm: model, tools: [add, multiply], name: "math_expert", prompt: "You are a math expert. Use one tool at a time." });
const researchAgent = createReactAgent({ llm: model, tools: [webSearch], name: "research_expert", prompt: "You are a world class researcher with web access. No math." });

// Create supervisor workflow
const workflow = createSupervisor({
  agents: [researchAgent, mathAgent],
  llm: model,
  prompt:
    "You are a team supervisor managing a research expert and a math expert. Use research_expert for knowledge/queries and math_expert for calculations."
});

// Compile and run
const app = workflow.compile();
const result = await app.invoke({ messages: [{ role: 'user', content: 'What is 42 * 7? Who is the CEO of Apple?' }] });
console.log(result);
```

---

## 📝 Message History Management

By default, supervisors include full agent message history. You can switch modes:

- **Full history**: include all messages from agents.
  ```ts
  const sup = createSupervisor({ agents, llm, outputMode: 'full_history' });
  ```

- **Last message**: include only final agent response.
  ```ts
  const sup = createSupervisor({ agents, llm, outputMode: 'last_message' });
  ```

---

## 📁 Multi-level Hierarchies

Supervisors can manage other supervisors.

```ts
const researchTeam = createSupervisor({ agents: [researchAgent, mathAgent], llm: model }).compile({ name: 'research_team' });
const writingTeam = createSupervisor({ agents: [writingAgent, publishAgent], llm: model }).compile({ name: 'writing_team' });

const topLevel = createSupervisor({
  agents: [researchTeam, writingTeam],
  llm: model
}).compile({ name: 'top_level_supervisor' });
```

---

## 🧠 Adding Memory

Attach checkpointer/store to persist state across runs.

```ts
import { MemorySaver, InMemoryStore } from '@langchain/langgraph';

const checkpointer = new MemorySaver();
const store = new InMemoryStore();

const app = createSupervisor({ agents, llm })
  .compile({ checkpointer, store });
```

---

## 🔗 Resources

- **Repository**: https://github.com/langchain-ai/langgraphjs
- **Homepage/Docs**: https://github.com/langchain-ai/langgraphjs#readme
- **npm**: https://www.npmjs.com/package/@langchain/langgraph-supervisor 