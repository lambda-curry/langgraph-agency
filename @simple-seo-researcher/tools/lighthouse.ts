import { DynamicStructuredTool } from '@langchain/core/tools';
import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import type { LighthouseResponse } from '../types';

interface LighthouseInput {
  url: string;
  strategy?: 'mobile' | 'desktop';
  categories?: Array<
    'performance' | 'accessibility' | 'best-practices' | 'seo' | 'pwa'
  >;
  locale?: string;
}

export const createLighthouseTool = (apiKey: string) =>
  new DynamicStructuredTool({
    name: 'lighthouse',
    description: 'Run Lighthouse audit using Google PageSpeed Insights API',
    schema: z.object({
      url: z.string().url(),
      strategy: z.enum(['mobile', 'desktop']).optional(),
      categories: z
        .array(
          z.enum([
            'performance',
            'accessibility',
            'best-practices',
            'seo',
            'pwa',
          ])
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
      apiUrl.searchParams.append('key', apiKey);
      apiUrl.searchParams.append('strategy', strategy);
      for (const category of categories) {
        apiUrl.searchParams.append('category', category);
      }
      apiUrl.searchParams.append('locale', locale);

      const response = await fetch(apiUrl.toString());
      if (!response.ok) {
        throw new Error(
          `Lighthouse API request failed: ${response.statusText}`
        );
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
          performance:
            data.lighthouseResult?.categories?.performance?.score || 0,
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

      return {
        audit: result,
      };
    },
  });
