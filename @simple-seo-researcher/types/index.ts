/* ----- */
/*                        SERP API Response Types (v2)                        */
/* ----- */

export interface SerpMenuItem {
  title: string;
  link: string;
  position: number;
}

export interface SerpOrganicResult {
  title: string;
  displayed_link: string;
  snippet: string;
  link: string;
  rank: number;
}

export interface SerpSearchInformation {
  query_displayed: string;
  organic_results_state?: string;
}

export interface SerpPagination {
  page_no: Record<string, unknown>;
}

export interface SerpApiResponse {
  search_information: SerpSearchInformation;
  menu_items: SerpMenuItem[];
  organic_results: SerpOrganicResult[];
  pagination: SerpPagination;
  people_also_ask?: Array<{
    question: string;
    id: string;
    rank: number;
    answers: string;
  }>;
}

/**
 * @deprecated Use SerpApiResponse instead
 */
export interface GoogleSearchResult {
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

export interface LighthouseResponse {
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

export interface ResearchContext {
  url: string;
  keywords?: string[];
  competitors?: string[];
  audit?: unknown;
  log: string[];
}
