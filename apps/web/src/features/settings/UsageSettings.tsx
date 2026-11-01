import { useQuery } from '@tanstack/react-query';
import { FEATURES, lockMessage, type Feature, type TierLimits } from '@lumen/shared';
import { Badge, Card, CardHeader, Meter, Skeleton } from '@lumen/ui';
import { Check, Lock } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useMe } from '../../lib/auth.js';
import { formatBytes } from '../../lib/i18n.js';

const FEATURE_LABELS: Record<Feature, string> = {
  chat: 'Chat', codeMode: 'Code Mode (Linux sandbox)', apiKeys: 'API keys', scheduledTasks: 'Scheduled tasks', themePublishing: 'Publish themes',
  projectSharing: 'Project sharing', publicShareLinks: 'Public share links', mcpCustomServers: 'Custom MCP servers', connectors: 'Connectors',
  imageGeneration: 'Image generation', webSearch: 'Web search', deepResearch: 'Deep research', fileUpload: 'File uploads', memory: 'Memory',
  voiceMode: 'Voice mode', workshopPublishing: 'Workshop publishing', clientCodeInterpreter: 'In-browser code runner',
};

export function UsageSettings() {
  const { data: me } = useMe();
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<{ tierId: string; limits: TierLimits; usage: { metric: string; used: number; limit: number }[]; resetAt: string }>('/api/me/usage') });
  const ent = me?.entitlements;
  return (
    <>
      <Card>
        <CardHeader title="Today’s allowance" description={usage.data ? `Resets ${new Date(usage.data.resetAt).toLocaleString()}` : undefined} action={ent ? <Badge tone="accent">{ent.tierId}</Badge> : null} />
        {usage.isLoading ? <Skeleton className="h-24" /> : null}
        <div className="flex flex-col gap-4">
          {usage.data?.usage.map((u) => <Meter key={u.metric} label={u.metric[0]!.toUpperCase() + u.metric.slice(1)} value={u.used} max={u.limit} format={(n) => n.toLocaleString()} />)}
        </div>
      </Card>
      {ent ? (
        <Card>
          <CardHeader title="Limits" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between"><dt className="text-fg-2">Max file size</dt><dd>{formatBytes(ent.limits.maxUploadBytes)}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">File storage</dt><dd>{formatBytes(ent.limits.storageBytes)}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Sandbox storage</dt><dd>{formatBytes(ent.limits.sandboxStorageBytes)}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Sandbox hours / day</dt><dd>{ent.limits.sandboxHoursPerDay}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Scheduled tasks</dt><dd>{ent.limits.scheduledTasks}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Concurrent chats</dt><dd>{ent.limits.concurrentStreams}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">Images / day</dt><dd>{ent.limits.imageGenPerDay}</dd></div>
            <div className="flex justify-between"><dt className="text-fg-2">API keys</dt><dd>{ent.limits.apiKeys}</dd></div>
          </dl>
        </Card>
      ) : null}
      {ent ? (
        <Card>
          <CardHeader title="Features" />
          <ul className="grid gap-2 sm:grid-cols-2">
            {FEATURES.map((f) => {
              const st = ent.features[f];
              return (
                <li key={f} className="flex items-start gap-2 text-sm">
                  {st.allowed ? <Check size={16} className="mt-0.5 text-success" aria-label="Available" /> : <Lock size={16} className="mt-0.5 text-fg-3" aria-label="Locked" />}
                  <span>
                    <span className={st.allowed ? 'text-fg' : 'text-fg-2'}>{FEATURE_LABELS[f]}</span>
                    {!st.allowed && st.reason ? <span className="block text-xs text-fg-3">{lockMessage(st.reason)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
