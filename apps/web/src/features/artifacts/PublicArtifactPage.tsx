import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ARTIFACT_TYPE_LABELS } from '@lumen/shared';
import { Badge, Banner, Button, Skeleton, toast } from '@lumen/ui';
import { GitFork } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { meQueryOptions } from '../../lib/auth.js';
import { artifactApi } from './api.js';
import { ArtifactRenderer } from './renderers/ArtifactRenderer.js';
import type { PublicArtifact } from './types.js';

/** Read-only view of a published artifact. `?embed=1` shows only the artifact (for iframes on other sites). */
export function PublicArtifactPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const { embed } = useSearch({ strict: false }) as { embed?: string };
  const navigate = useNavigate();
  const me = useQuery(meQueryOptions);
  const q = useQuery({ queryKey: ['public-artifact', slug], queryFn: () => api<PublicArtifact>(`/api/public/artifacts/${encodeURIComponent(slug)}`), retry: false });
  const signedIn = Boolean(me.data);

  const remix = async () => {
    if (!signedIn) return void navigate({ to: '/login', search: { redirect: `/a/${slug}` } });
    try {
      const a = await artifactApi.forkPublic(slug);
      await navigate({ to: '/artifacts', search: { open: a.id } });
    } catch (e) {
      toast.error('Remix failed', errorMessage(e));
    }
  };

  if (q.isLoading) return <div className="mx-auto flex max-w-5xl flex-col gap-3 p-6"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-96" /></div>;
  if (q.isError || !q.data) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Banner tone="warning" title="This artifact isn’t available">It may have been unpublished or deleted.</Banner>
      </div>
    );
  }
  const a = q.data;
  const view = <ArtifactRenderer artifactId={a.id} type={a.type} title={a.title} content={a.content} language={a.language} bridge={signedIn} />;
  if (embed === '1') return <main className="h-dvh overflow-auto bg-bg">{view}</main>;
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-fg">{a.title}</h1>
        <Badge>{ARTIFACT_TYPE_LABELS[a.type]}</Badge>
        <Button size="sm" variant="secondary" onClick={() => void remix()}><GitFork size={14} aria-hidden="true" /> Remix</Button>
        <Link to="/" className="text-sm font-medium text-accent underline underline-offset-2">Made with Lumen</Link>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">{view}</main>
      {(a.type === 'html' || a.type === 'react') && !signedIn ? <p className="border-t border-border px-4 py-1.5 text-xs text-fg-2">Sign in to use this app’s AI and saved-data features.</p> : null}
    </div>
  );
}
