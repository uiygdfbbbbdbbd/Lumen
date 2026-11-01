import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reduce, type LiveStream } from '../src/features/chat/store.js';
import { MemoryToolCard, MemoryUsed } from '../src/features/memory/MemoryUsed.js';

function renderWithProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const empty: LiveStream = { text: '', reasoning: '', tools: [], status: 'streaming', error: null, fallback: null, compacted: false, reconnecting: false, usage: null, citations: [], artifacts: [], memoryIds: [] };

afterEach(() => vi.unstubAllGlobals());

describe('memory in chat', () => {
  it('records which memories a live response used', () => {
    expect(reduce(empty, { type: 'memory', ids: ['a', 'b'] }).memoryIds).toEqual(['a', 'b']);
  });

  it('describes memory tool calls in plain language', async () => {
    renderWithProviders(
      <>
        <MemoryToolCard name="memory_write" args={{ content: 'Likes tea.' }} result={{ content: 'Saved to memory for all chats (id: x).', isError: false }} />
        <MemoryToolCard name="memory_write" args={{ content: 'Likes tea.' }} result={{ content: 'Already remembered; updated the existing memory (id: x).', isError: false }} />
        <MemoryToolCard name="memory_write" args={{ content: 'pw' }} result={{ content: 'Error: This looks like a password. Secrets are never saved to memory.', isError: true }} />
        <MemoryToolCard name="memory_delete" args={{ id: 'x' }} result={{ content: 'Forgot: Likes tea.', isError: false }} />
        <MemoryToolCard name="memory_update" args={{ id: 'x', content: 'Likes green tea.' }} result={{ content: 'Updated', isError: false }} />
        <MemoryToolCard name="memory_search" args={{ query: 'tea' }} />
        <MemoryToolCard name="conversation_search" args={{ query: 'zanzibar' }} result={{ content: '- "Trip"', isError: false }} />
      </>,
    );
    expect(await screen.findByText('Saved to memory: Likes tea.')).toBeInTheDocument();
    expect(screen.getByText('Already remembered: Likes tea.')).toBeInTheDocument();
    expect(screen.getByText('Didn’t save to memory')).toBeInTheDocument();
    expect(screen.getByText('This looks like a password. Secrets are never saved to memory.')).toBeInTheDocument();
    expect(screen.getByText('Forgot: Likes tea.')).toBeInTheDocument();
    expect(screen.getByText('Updated memory: Likes green tea.')).toBeInTheDocument();
    expect(screen.getByText('Checking memory…')).toBeInTheDocument();
    expect(screen.getByText('Searched past chats for “zanzibar”')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Manage' }).length).toBeGreaterThan(0);
  });

  it('shows the memories behind a response, noting deleted ones', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'a', content: 'Prefers metric units.', category: 'preferences' }] }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<MemoryUsed ids={['a', 'b']} />);
    await user.click(await screen.findByRole('button', { name: 'Memory used (2)' }));
    expect(await screen.findByText('Prefers metric units.')).toBeInTheDocument();
    expect(screen.getByText('1 memory has since been deleted.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/memories/lookup?ids=a,b', expect.anything());
  });

  it('renders nothing when no memories were used', async () => {
    renderWithProviders(<div data-testid="host"><MemoryUsed ids={[]} /></div>);
    expect(await screen.findByTestId('host')).toBeEmptyDOMElement();
  });
});
