Agent Supervisor
The previous example routed messages automatically based on the output of the initial researcher agent.

We can also choose to use an LLM to orchestrate the different agents.

Below, we will create an agent group, with an agent supervisor to help delegate tasks.

diagram

To simplify the code in each agent node, we will use the AgentExecutor class from LangChain. This and other "advanced agent" notebooks are designed to show how you can implement certain design patterns in LangGraph. If the pattern suits your needs, we recommend combining it with some of the other fundamental patterns described elsewhere in the docs for best performance.

Before we build, let's configure our environment:

// process.env.OPENAI_API_KEY = "sk_...";
// process.env.TAVILY_API_KEY = "sk_...";
// Optional tracing in LangSmith
// process.env.LANGCHAIN_API_KEY = "sk_...";
// process.env.LANGCHAIN_TRACING_V2 = "true";
// process.env.LANGCHAIN_PROJECT = "Agent Supervisor: LangGraphJS";
import "dotenv/config";
Define State
We first define the state of the graph. This will just a list of messages, along with a key to track the most recent sender

import { END, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// This defines the object that is passed between each node
// in the graph. We will create different nodes for each agent and tool
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // The agent node that last performed work
  next: Annotation<string>({
    reducer: (x, y) => y ?? x ?? END,
    default: () => END,
  }),
});
Create tools
For this example, you will make an agent to do web research with a search engine, and one agent to create plots. Define the tools they'll use below:

require("esm-hook"); // Only for running this in TSLab. See: https://github.com/yunabe/tslab/issues/72
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { DynamicStructuredTool } from "@langchain/core/tools";
import * as d3 from "d3";
// ----------ATTENTION----------
// If attempting to run this notebook locally, you must follow these instructions
// to install the necessary system dependencies for the `canvas` package.
// https://www.npmjs.com/package/canvas#compiling
// -----------------------------
import { createCanvas } from "canvas";
import { z } from "zod";
import * as tslab from "tslab";

const chartTool = new DynamicStructuredTool({
  name: "generate_bar_chart",
  description:
    "Generates a bar chart from an array of data points using D3.js and displays it for the user.",
  schema: z.object({
    data: z
      .object({
        label: z.string(),
        value: z.number(),
      })
      .array(),
  }),
  func: async ({ data }) => {
    const width = 500;
    const height = 500;
    const margin = { top: 20, right: 30, bottom: 30, left: 40 };

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.label))
      .range([margin.left, width - margin.right])
      .padding(0.1);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.value) ?? 0])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const colorPalette = [
      "#e6194B",
      "#3cb44b",
      "#ffe119",
      "#4363d8",
      "#f58231",
      "#911eb4",
      "#42d4f4",
      "#f032e6",
      "#bfef45",
      "#fabebe",
    ];

    data.forEach((d, idx) => {
      ctx.fillStyle = colorPalette[idx % colorPalette.length];
      ctx.fillRect(
        x(d.label) ?? 0,
        y(d.value),
        x.bandwidth(),
        height - margin.bottom - y(d.value),
      );
    });

    ctx.beginPath();
    ctx.strokeStyle = "black";
    ctx.moveTo(margin.left, height - margin.bottom);
    ctx.lineTo(width - margin.right, height - margin.bottom);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    x.domain().forEach((d) => {
      const xCoord = (x(d) ?? 0) + x.bandwidth() / 2;
      ctx.fillText(d, xCoord, height - margin.bottom + 6);
    });

    ctx.beginPath();
    ctx.moveTo(margin.left, height - margin.top);
    ctx.lineTo(margin.left, height - margin.bottom);
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const ticks = y.ticks();
    ticks.forEach((d) => {
      const yCoord = y(d); // height - margin.bottom - y(d);
      ctx.moveTo(margin.left, yCoord);
      ctx.lineTo(margin.left - 6, yCoord);
      ctx.stroke();
      ctx.fillText(d.toString(), margin.left - 8, yCoord);
    });
    await tslab.display.png(canvas.toBuffer());
    return "Chart has been generated and displayed to the user!";
  },
});

const tavilyTool = new TavilySearchResults();
Create Agent Supervisor
The supervisor routes the work between our worker agents.

import { z } from "zod";
import { ChatAnthropic } from "@langchain/anthropic";

import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

const members = ["researcher", "chart_generator"] as const;

const systemPrompt =
  "You are a supervisor tasked with managing a conversation between the" +
  " following workers: {members}. Given the following user request," +
  " respond with the worker to act next. Each worker will perform a" +
  " task and respond with their results and status. When finished," +
  " respond with FINISH.";
const options = [END, ...members];

// Define the routing function
const routingTool = {
  name: "route",
  description: "Select the next role.",
  schema: z.object({
    next: z.enum([END, ...members]),
  }),
}

const prompt = ChatPromptTemplate.fromMessages([
  ["system", systemPrompt],
  new MessagesPlaceholder("messages"),
  [
    "human",
    "Given the conversation above, who should act next?" +
    " Or should we FINISH? Select one of: {options}",
  ],
]);

const formattedPrompt = await prompt.partial({
  options: options.join(", "),
  members: members.join(", "),
});

const llm = new ChatAnthropic({
  modelName: "claude-3-5-sonnet-20241022",
  temperature: 0,
});

const supervisorChain = formattedPrompt
  .pipe(llm.bindTools(
    [routingTool],
    {
      tool_choice: "route",
    },
  ))
  // select the first one
  .pipe((x) => (x.tool_calls[0].args));
import { HumanMessage } from "@langchain/core/messages";

await supervisorChain.invoke({
  messages: [
    new HumanMessage({
      content: "write a report on birds.",
    }),
  ],
});
{ next: 'researcher' }
Construct Graph
We're ready to start building the graph. First, create the agents to add to the graph.

Compatibility

The stateModifier parameter was added in @langchain/langgraph>=0.2.27.
If you are on an older version, you will need to use the deprecated messageModifier parameter.
For help upgrading, see this guide.

import { RunnableConfig } from "@langchain/core/runnables";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { SystemMessage } from "@langchain/core/messages";

// Recall llm was defined as ChatOpenAI above
// It could be any other language model
const researcherAgent = createReactAgent({
  llm,
  tools: [tavilyTool],
  stateModifier: new SystemMessage("You are a web researcher. You may use the Tavily search engine to search the web for" +
    " important information, so the Chart Generator in your team can make useful plots.")
})

const researcherNode = async (
  state: typeof AgentState.State,
  config?: RunnableConfig,
) => {
  const result = await researcherAgent.invoke(state, config);
  const lastMessage = result.messages[result.messages.length - 1];
  return {
    messages: [
      new HumanMessage({ content: lastMessage.content, name: "Researcher" }),
    ],
  };
};

const chartGenAgent = createReactAgent({
  llm,
  tools: [chartTool],
  stateModifier: new SystemMessage("You excel at generating bar charts. Use the researcher's information to generate the charts.")
})

const chartGenNode = async (
  state: typeof AgentState.State,
  config?: RunnableConfig,
) => {
  const result = await chartGenAgent.invoke(state, config);
  const lastMessage = result.messages[result.messages.length - 1];
  return {
    messages: [
      new HumanMessage({ content: lastMessage.content, name: "ChartGenerator" }),
    ],
  };
};
Now we can create the graph itself! Add the nodes, and add edges to define how how work will be performed in the graph.

import { START, StateGraph } from "@langchain/langgraph";

// 1. Create the graph
const workflow = new StateGraph(AgentState)
  // 2. Add the nodes; these will do the work
  .addNode("researcher", researcherNode)
  .addNode("chart_generator", chartGenNode)
  .addNode("supervisor", supervisorChain);
// 3. Define the edges. We will define both regular and conditional ones
// After a worker completes, report to supervisor
members.forEach((member) => {
  workflow.addEdge(member, "supervisor");
});

workflow.addConditionalEdges(
  "supervisor",
  (x: typeof AgentState.State) => x.next,
);

workflow.addEdge(START, "supervisor");

const graph = workflow.compile();
Invoke the team
With the graph created, we can now invoke it and see how it performs!

let streamResults = graph.stream(
  {
    messages: [
      new HumanMessage({
        content: "What were the 3 most popular tv shows in 2023?",
      }),
    ],
  },
  { recursionLimit: 100 },
);

for await (const output of await streamResults) {
  if (!output?.__end__) {
    console.log(output);
    console.log("----");
  }
}
{ supervisor: { next: 'researcher' } }
----
{
  researcher: {
    messages: [
      HumanMessage {
        "content": "Based on the search results, I can tell you about the most popular TV shows in 2023 across both traditional television and streaming platforms:\n\n1. \"Succession\" (HBO) - The final season was one of the most critically acclaimed and watched shows of 2023\n2. \"The Last of Us\" (HBO) - This adaptation became a massive hit and one of HBO's most-watched series ever\n3. \"Wednesday\" (Netflix) - This show continued its popularity from late 2022 into 2023 and remained one of the most-streamed shows\n\nIt's worth noting that different metrics (network TV vs. streaming, total viewers vs. ratings) can yield different results. For traditional network television, \"NFL Sunday Night Football\" was technically the most-watched program, but I focused on scripted series for this list.\n\nGiven the conversation above, we should have the chart_generator act next, as they can create visualizations showing the viewership numbers or ratings for these popular shows.\n\nAnswer: chart_generator",
        "name": "Researcher",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: 'researcher' } }
----
{
  researcher: {
    messages: [
      HumanMessage {
        "content": "Based on the search results, I can provide information about the most popular TV shows in 2023:\n\n1. \"Succession\" (HBO) - The series finale drew 2.9 million viewers, with Season 4 averaging 710,000 viewers per episode, making it the show's most popular season.\n\n2. \"The Last of Us\" (HBO) - The show had a strong debut with 837 million minutes watched in just its first full week of availability on HBO Max.\n\n3. \"Wednesday\" (Netflix) - While specific 2023 numbers aren't readily available in the search results, the show maintained its popularity from its record-breaking 2022 debut throughout 2023.\n\nIt's worth noting that measuring TV show popularity has become complex due to different platforms and viewing methods. Traditional TV measurements (like Nielsen ratings) differ from streaming minutes watched, and some shows are popular across both formats. Additionally, NFL's Sunday Night Football remained the most-watched program overall on traditional television, averaging 19.73 million viewers in the 2023-24 season.\n\nGiven the conversation above, we should have the chart_generator act next, as they can create visualizations showing these viewership numbers across different metrics.\n\nAnswer: chart_generator",
        "name": "Researcher",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: 'researcher' } }
----
{
  researcher: {
    messages: [
      HumanMessage {
        "content": "Based on the search results, I can provide detailed information about the most popular TV shows in 2023:\n\n1. \"Succession\" (HBO)\n- Series finale drew 2.9 million viewers\n- Season 4 averaged 710,000 viewers per episode (live viewing)\n- When including delayed viewing, Season 4 averaged 8.7 million viewers per episode\n- Most watched season of the series\n\n2. \"The Last of Us\" (HBO)\n- Became one of HBO's biggest hits\n- Demonstrated extremely high demand in streaming metrics\n- Outperformed many other popular streaming shows including \"Wednesday\" in terms of viewer demand\n- Specific episode viewership data varied throughout the season\n\n3. \"Wednesday\" (Netflix)\n- Remained one of Netflix's top English-language series of all time\n- Continued strong performance into 2023 from its late 2022 debut\n- Exact viewing hours for 2023 aren't specifically broken out in Netflix's engagement reports\n\nIt's worth noting that comparing shows across different platforms is challenging due to varying measurement methods:\n- Traditional TV uses Nielsen ratings\n- Streaming services use hours viewed\n- Some platforms count delayed viewing while others don't\n- HBO shows often have both cable and streaming numbers\n\nGiven the conversation above, we should have the chart_generator act next, as they can create visualizations showing these viewership numbers, particularly for Succession where we have the most concrete data across different viewing methods.\n\nAnswer: chart_generator",
        "name": "Researcher",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: 'researcher' } }
----
{
  researcher: {
    messages: [
      HumanMessage {
        "content": "Based on the additional search results, I can now provide more precise viewership data:\n\n1. \"Succession\" (HBO)\n- Series finale: 2.928 million viewers (live)\n- Season 4 cumulative average: 8.7 million viewers per episode (including repeats and HBO Max)\n- This was up 1.5 million viewers from Season 3\n\n2. \"The Last of Us\" (HBO)\n- Averaged over 20 million viewers per episode (including delayed viewing and HBO Max)\n- Viewership nearly doubled from its first episode\n- One of HBO's biggest hits of 2023\n\n3. \"Wednesday\" (Netflix)\n- While specific 2023 numbers aren't broken out in the search results, it remained one of Netflix's most popular shows\n\nGiven this more detailed information, we should have the chart_generator act next to create visualizations showing:\n1. The comparison between live vs. cumulative viewing for Succession\n2. The growth trajectory of The Last of Us viewership\n3. A comparison of total viewership between these shows where metrics are comparable\n\nAnswer: chart_generator",
        "name": "Researcher",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: 'researcher' } }
----
{
  researcher: {
    messages: [
      HumanMessage {
        "content": "Based on the comprehensive search results, I can now provide the most accurate viewership data for these shows in 2023:\n\n1. \"Succession\" (HBO)\n- Series finale: 2.928 million viewers (live)\n- Season 4 average: 8.7 million viewers per episode (including delayed viewing and HBO Max)\n- Significant growth from previous seasons\n\n2. \"The Last of Us\" (HBO)\n- Started with 4.7 million viewers (premiere)\n- Grew to 8.1 million viewers by Episode 8\n- Final viewership numbers showed consistent growth:\n  * Episode 1: 4.7M\n  * Episode 2: 5.7M (+22%)\n  * Episode 4: 7.5M\n  * Episode 8: 8.1M\n  * Overall series average reached about 20 million viewers per episode when including all viewing methods\n\n3. \"Wednesday\" (Netflix)\n- While specific 2023 numbers aren't broken out in detail, it maintained its position as one of Netflix's most-watched shows\n\nGiven this comprehensive data, we should have the chart_generator act next to create visualizations showing:\n1. The episode-by-episode growth of The Last of Us viewership\n2. The comparison between live vs. cumulative viewing for Succession's final season\n3. A comparison of total viewership between these HBO shows where metrics are comparable\n\nAnswer: chart_generator",
        "name": "Researcher",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: 'chart_generator' } }
----



{
  chart_generator: {
    messages: [
      HumanMessage {
        "content": "These visualizations help illustrate:\n1. The steady growth in viewership for The Last of Us over its first season\n2. The significant difference between live viewing and total viewing numbers for Succession\n3. The overall viewership comparison between the two HBO shows when including all viewing methods\n\nNote that Wednesday (Netflix) isn't included in these comparisons because its 2023 viewership numbers weren't specifically broken out in the available data.",
        "name": "ChartGenerator",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: '__end__' } }
----
streamResults = graph.stream(
  {
    messages: [
      new HumanMessage({
        content: "Generate a bar chart of the US GDP growth from 2021-2023.",
      }),
    ],
  },
  { recursionLimit: 150 },
);

for await (const output of await streamResults) {
  if (!output?.__end__) {
    console.log(output);
    console.log("----");
  }
}
{ supervisor: { next: 'researcher' } }
----
{
  researcher: {
    messages: [
      HumanMessage {
        "content": "Based on the search results, I have found the annual GDP growth rates for the United States from 2021 to 2023:\n\n2021: 5.80%\n2022: 1.94%\n2023: 2.54%\n\nNow that I have gathered the necessary data, the Chart Generator should create a bar chart using these values.\n\nThe next actor should be: chart_generator",
        "name": "Researcher",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: 'chart_generator' } }
----

{
  chart_generator: {
    messages: [
      HumanMessage {
        "content": "I've generated a bar chart showing the US GDP growth rates for the years 2021-2023. The chart displays:\n- 2021: 5.80%\n- 2022: 1.94%\n- 2023: 2.54%\n\nThe chart clearly shows that 2021 had the highest GDP growth rate at 5.80%, followed by a significant decrease in 2022 to 1.94%, and then a slight increase in 2023 to 2.54%.",
        "name": "ChartGenerator",
        "additional_kwargs": {},
        "response_metadata": {}
      }
    ]
  }
}
----
{ supervisor: { next: '__end__' } }
----