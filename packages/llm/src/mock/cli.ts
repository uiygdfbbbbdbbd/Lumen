#!/usr/bin/env node
import { startMockProvider } from './server.js';

const port = Number(process.env.MOCK_LLM_PORT ?? 4010);
const mock = await startMockProvider({ port, host: process.env.MOCK_LLM_HOST ?? '127.0.0.1', apiKey: process.env.MOCK_LLM_API_KEY });
console.warn(`Mock LLM provider listening on ${mock.url}
  OpenAI-compatible: ${mock.url}/v1     Anthropic: ${mock.url}     Gemini: ${mock.url}
  Ollama: ${mock.url}                   Cohere: ${mock.url}
  Models: mock-fast, mock-smart, mock-vision, mock-reasoning`);
