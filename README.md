# agency

To install dependencies:

```bash
bun install
```

## Environment Setup

Create a `.env` file in the root directory with the following variables:

```bash
OPENAI_API_KEY=your_openai_api_key
SCRAPINGDOG_API_KEY=your_scrapingdog_api_key
GOOGLE_API_KEY=your_google_api_key
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
LANGFUSE_BASE_URL=your_langfuse_base_url
```

## Running the Project

To run the main project:

```bash
bun run index.ts
```

To try out the SEO researcher:

```bash
bun run @simple-seo-researcher/index.ts
```

This project was created using `bun init` in bun v1.0.26. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
