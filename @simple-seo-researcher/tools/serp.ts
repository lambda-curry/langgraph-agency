import { DynamicStructuredTool } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import type { GoogleSearchResult, SerpApiResponse } from '../types';

interface SerpKeywordsInput {
  url: string;
  query?: string;
  country?: string;
  language?: string;
}

export const createSerpKeywordsTool = (apiKey: string) =>
  new DynamicStructuredTool({
    name: 'serp_keywords',
    description: 'Get keywords and search results from Google SERP API',
    schema: z.object({
      url: z.string().url().describe('The URL to analyze'),
      query: z.string().optional().describe('A specific query to search for'),
      country: z.string().optional().describe('The country to search in'),
      language: z.string().optional().describe('The language to search in'),
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
      apiUrl.searchParams.append('api_key', apiKey);
      apiUrl.searchParams.append('query', searchQuery);
      apiUrl.searchParams.append('country', country);
      apiUrl.searchParams.append('language', language);

      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error(`SERP API request failed: ${response.statusText}`);
      }

      const data = (await response.json()) as SerpApiResponse;

      if (!data.organic_results || !Array.isArray(data.organic_results)) {
        throw new Error(
          `SERP API response missing 'organic_results'. Raw response: ${JSON.stringify(data)}`
        );
      }

      // Extract keywords from titles and snippets
      const keywords = new Set<string>();
      for (const result of data.organic_results) {
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

      // return the raw data so ToolNode will wrap it in a ToolMessage
      return {
        keywords: Array.from(keywords),
        searchResults: data.organic_results,
        relatedQuestions: data.people_also_ask || [],
        menuItems: data.menu_items,
        searchInformation: data.search_information,
        pagination: data.pagination,
      };
    },
  });
