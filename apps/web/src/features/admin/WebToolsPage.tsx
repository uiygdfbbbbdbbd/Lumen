import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, CardHeader, Field, Input, Select, SwitchRow, Textarea, toast } from '@lumen/ui';
import { api, errorMessage } from '../../lib/api.js';

interface WebSearch {
  provider: 'none' | 'searxng' | 'brave' | 'tavily' | 'serper' | 'bing';
  baseUrl: string;
  hasApiKey: boolean;
  maxResults: number;
  safeSearch: boolean;
  respectRobots: boolean;
  cacheTtlMinutes: number;
  fetchMaxChars: number;
  blockedDomains: string[];
}
interface Tools {
  weather: boolean;
  currency: boolean;
}

const PROVIDERS: { id: WebSearch['provider']; label: string; needsKey: boolean }[] = [
  { id: 'none', label: 'Off', needsKey: false },
  { id: 'searxng', label: 'SearXNG (self-hosted)', needsKey: false },
  { id: 'brave', label: 'Brave Search API', needsKey: true },
  { id: 'tavily', label: 'Tavily', needsKey: true },
  { id: 'serper', label: 'Serper (Google results)', needsKey: true },
  { id: 'bing', label: 'Bing Web Search', needsKey: true },
];

export function WebToolsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ webSearch: WebSearch; tools: Tools }>('/api/admin/settings') });
  const [ws, setWs] = useState<WebSearch | null>(null);
  const [tools, setTools] = useState<Tools | null>(null);
  const [blocked, setBlocked] = useState('');
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ latencyMs: number; results: { title: string; url: string }[] } | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    setWs(settings.data.webSearch);
    setTools(settings.data.tools);
    setBlocked(settings.data.webSearch.blockedDomains.join('\n'));
  }, [settings.data]);
  if (!ws || !tools) return null;
  const provider = PROVIDERS.find((p) => p.id === ws.provider)!;
  const set = <K extends keyof WebSearch>(k: K, v: WebSearch[K]) => setWs({ ...ws, [k]: v });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'settings'] });

  const save = async () => {
    try {
      const { hasApiKey: _k, ...body } = ws;
      await api('/api/admin/settings/webSearch', { method: 'PUT', body: { ...body, blockedDomains: blocked.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean) } });
      if (key.trim()) {
        await api('/api/admin/web-search/key', { method: 'PUT', body: { apiKey: key.trim() } });
        setKey('');
      }
      await refresh();
      toast.success('Web search settings saved');
    } catch (e) {
      toast.error('Couldn’t save', errorMessage(e));
    }
  };

  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">Web & tools</h2>
        <p className="text-sm text-fg-2">What the AI can look up beyond its training data.</p>
      </header>
      <Card>
        <CardHeader title="Web search" description="Lets the AI search the web and read pages, with numbered citations. Pages are fetched through an SSRF-protected client that respects robots.txt." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Search provider">
            <Select value={ws.provider} onChange={(e) => set('provider', e.target.value as WebSearch['provider'])}>
              {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </Field>
          {ws.provider === 'searxng' ? (
            <Field label="SearXNG URL" hint="Enable the JSON format in the instance’s settings.yml."><Input value={ws.baseUrl} placeholder="http://searxng:8080" onChange={(e) => set('baseUrl', e.target.value)} /></Field>
          ) : provider.needsKey ? (
            <Field label="API key" hint={ws.hasApiKey ? 'A key is saved. Enter a new one to replace it.' : 'Stored encrypted; it can’t be viewed again.'}>
              <Input type="password" autoComplete="off" value={key} placeholder={ws.hasApiKey ? '••••••••' : ''} onChange={(e) => setKey(e.target.value)} />
            </Field>
          ) : <div />}
          <Field label="Results per search"><Input type="number" min={1} max={20} value={ws.maxResults} onChange={(e) => set('maxResults', Number(e.target.value))} /></Field>
          <Field label="Cache results for (minutes)" hint="0 disables caching."><Input type="number" min={0} max={1440} value={ws.cacheTtlMinutes} onChange={(e) => set('cacheTtlMinutes', Number(e.target.value))} /></Field>
          <Field label="Max characters read per page"><Input type="number" min={1000} max={200000} value={ws.fetchMaxChars} onChange={(e) => set('fetchMaxChars', Number(e.target.value))} /></Field>
        </div>
        <SwitchRow label="Safe search" checked={ws.safeSearch} onCheckedChange={(v) => set('safeSearch', v)} />
        <SwitchRow label="Respect robots.txt" description="Skip pages that ask automated agents not to read them." checked={ws.respectRobots} onCheckedChange={(v) => set('respectRobots', v)} />
        <Field label="Blocked domains" hint="One per line. Subdomains are blocked too. Also used to filter Deep Research sources." className="mt-2">
          <Textarea value={blocked} onChange={(e) => setBlocked(e.target.value)} className="min-h-20 font-mono text-xs" placeholder={'contentfarm.example\nspam.example'} />
        </Field>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {ws.hasApiKey && provider.needsKey ? (
            <Button variant="ghost" onClick={async () => { await api('/api/admin/web-search/key', { method: 'PUT', body: { apiKey: null } }); await refresh(); toast.success('API key removed'); }}>Remove key</Button>
          ) : null}
          <Button
            variant="secondary"
            loading={testing}
            disabled={ws.provider === 'none'}
            onClick={async () => {
              setTesting(true);
              setTestResult(null);
              try {
                setTestResult(await api('/api/admin/web-search/test', { method: 'POST', body: { query: 'open source software' } }));
              } catch (e) {
                toast.error('Search test failed', errorMessage(e));
              } finally {
                setTesting(false);
              }
            }}
          >
            Test search
          </Button>
          <Button onClick={() => void save()}>Save web search</Button>
        </div>
        {testResult ? (
          <Banner tone="success" className="mt-3" title={`Search works (${testResult.latencyMs} ms)`}>
            <ul className="mt-1 list-disc pl-4 text-xs">{testResult.results.map((r) => <li key={r.url}>{r.title}</li>)}</ul>
          </Banner>
        ) : null}
        <p className="mt-2 text-xs text-fg-3">Saved settings apply to new messages. Unsaved changes aren’t used by “Test search”.</p>
      </Card>
      <ImageSettingsCard />
      <Card>
        <CardHeader title="Data tools" description="Lookups that use free public data services." />
        <SwitchRow label={<>Weather <Badge>Open-Meteo</Badge></>} checked={tools.weather} onCheckedChange={(v) => setTools({ ...tools, weather: v })} />
        <SwitchRow label={<>Currency conversion <Badge>ECB rates</Badge></>} checked={tools.currency} onCheckedChange={(v) => setTools({ ...tools, currency: v })} />
        <div className="mt-4 flex justify-end">
          <Button onClick={async () => { try { await api('/api/admin/settings/tools', { method: 'PUT', body: tools }); await refresh(); toast.success('Tool settings saved'); } catch (e) { toast.error('Couldn’t save', errorMessage(e)); } }}>Save tools</Button>
        </div>
      </Card>
    </>
  );
}

function ImageSettingsCard() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<{ images: { defaultModelId: string | null; maxPerRequest: number } }>('/api/admin/settings') });
  const models = useQuery({ queryKey: ['admin', 'models'], queryFn: () => api<{ items: { id: string; displayName: string; providerModelId: string; enabled: boolean; capabilities: { imageGen?: boolean } }[] }>('/api/admin/models').then((r) => r.items) });
  const [cfg, setCfg] = useState<{ defaultModelId: string | null; maxPerRequest: number } | null>(null);
  useEffect(() => setCfg(settings.data?.images ?? null), [settings.data]);
  if (!cfg) return null;
  const imageModels = (models.data ?? []).filter((m) => m.capabilities.imageGen && m.enabled);
  return (
    <Card>
      <CardHeader title="Image generation" description="Models with the “image generation” capability create images in chat and on the Images page. Add Stability, Replicate, ComfyUI or an OpenAI-compatible images API under Providers. Daily limits per user come from tiers." />
      {!imageModels.length ? <Banner tone="info" className="mb-3">No enabled image models yet.</Banner> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Default image model">
          <Select value={cfg.defaultModelId ?? ''} onChange={(e) => setCfg({ ...cfg, defaultModelId: e.target.value || null })}>
            <option value="">First available</option>
            {imageModels.map((m) => <option key={m.id} value={m.id}>{m.displayName} ({m.providerModelId})</option>)}
          </Select>
        </Field>
        <Field label="Max images per request"><Input type="number" min={1} max={4} value={cfg.maxPerRequest} onChange={(e) => setCfg({ ...cfg, maxPerRequest: Number(e.target.value) })} /></Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={async () => { try { await api('/api/admin/settings/images', { method: 'PUT', body: cfg }); await qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); toast.success('Image settings saved'); } catch (e) { toast.error('Couldn’t save', errorMessage(e)); } }}>Save image settings</Button>
      </div>
    </Card>
  );
}
