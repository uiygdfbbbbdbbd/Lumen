import type { ToolDefinition } from '@lumen/llm';
import type { ChatStreamEvent } from '@lumen/shared';
import type { UserRow } from '../../db/schema/index.js';

export interface ToolContext {
  user: UserRow;
  conversationId: string | null;
  signal: AbortSignal;
  /** Files/project the model may search with file_search in this turn. */
  fileScope?: { fileIds: string[]; projectId: string | null };
  /** Project of the conversation (memory scope). */
  projectId?: string | null;
  /** Assistant message being generated (provenance for artifacts). */
  messageId?: string | null;
  /** Push an event to the live stream (e.g. artifact created). */
  emit?: (e: ChatStreamEvent) => Promise<void>;
}

export interface Tool {
  definition: ToolDefinition;
  /** Returns text for the model. Throwing produces an error result the model can react to. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.definition.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  definitions(names?: string[]): ToolDefinition[] {
    return [...this.tools.values()].filter((t) => !names || names.includes(t.definition.name)).map((t) => t.definition);
  }

  async execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) return { content: `Unknown tool "${name}".`, isError: true };
    if (args.__parseError) return { content: 'The tool arguments were not valid JSON. Try again with valid JSON.', isError: true };
    try {
      const content = await tool.run(args, ctx);
      // Tool output is untrusted data for the model; cap size to protect the context window.
      return { content: content.length > 50_000 ? `${content.slice(0, 50_000)}\n[truncated]` : content, isError: false };
    } catch (err) {
      return { content: `Error: ${(err as Error).message}`.slice(0, 2000), isError: true };
    }
  }
}
