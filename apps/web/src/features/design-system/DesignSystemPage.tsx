import { useState } from 'react';
import { COLOR_KEYS, checkContrast, contrastRatio, CONTRAST_RULES } from '@lumen/shared';
import {
  Avatar, Badge, Banner, Button, Card, CardHeader, Checkbox, ConfirmDialog, EmptyState, Field, IconButton, Input, Kbd, LockedFeature, Meter,
  PasswordStrength, Select, Skeleton, Spinner, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, toast,
} from '@lumen/ui';
import { Inbox, Plus, Trash2 } from 'lucide-react';
import { ALL_BUILTIN_THEMES, useThemeStore } from '../../lib/theme.js';
import { resolveTheme } from '../../lib/theme.js';

/** Living style guide: tokens, components and live theme switching (see docs/DESIGN-SYSTEM.md). */
export function DesignSystemPage() {
  const s = useThemeStore();
  const [confirm, setConfirm] = useState(false);
  const current = resolveTheme(s, { systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches, hour: new Date().getHours() }).theme;
  const issues = checkContrast(current.colors);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Design system</h1>
          <p className="text-sm text-fg-2">Tokens and components, rendered with the active theme.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Preview theme
          <Select className="w-48" value="" onChange={(e) => { const b = ALL_BUILTIN_THEMES.find((x) => x.id === e.target.value); if (b) s.set(b.theme.mode === 'dark' ? { mode: 'dark', darkThemeId: b.id } : { mode: 'light', lightThemeId: b.id }); }}>
            <option value="" disabled>{current.name}</option>
            {ALL_BUILTIN_THEMES.map((b) => <option key={b.id} value={b.id}>{b.theme.name}</option>)}
          </Select>
        </label>
      </header>
      <Card>
        <CardHeader title="Color tokens" description={issues.length ? `${issues.length} contrast warnings` : 'All WCAG AA contrast rules pass.'} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {COLOR_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <span className="h-8 w-8 shrink-0 rounded-sm border border-border" style={{ background: current.colors[k] }} />
              <span><span className="block font-medium text-fg">{k}</span><code className="text-fg-3">{current.colors[k]}</code></span>
            </div>
          ))}
        </div>
        <table className="mt-4 w-full text-left text-xs">
          <caption className="sr-only">Contrast ratios</caption>
          <thead><tr className="text-fg-3"><th className="py-1">Pair</th><th>Ratio</th><th>Min</th></tr></thead>
          <tbody>
            {CONTRAST_RULES.map((r) => {
              const ratio = contrastRatio(current.colors[r.fg], current.colors[r.bg]);
              return <tr key={r.label} className="border-t border-border"><td className="py-1">{r.label}</td><td className={ratio < r.min ? 'text-danger' : 'text-success'}>{ratio.toFixed(2)}</td><td>{r.min}</td></tr>;
            })}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader title="Typography" />
        <p className="text-3xl font-semibold">Display — The quick brown fox</p>
        <p className="text-xl font-semibold">Heading — jumps over the lazy dog</p>
        <p className="text-base">Body — Readable paragraphs use the base size and line height from the theme.</p>
        <p className="text-sm text-fg-2">Secondary — supporting copy.</p>
        <p className="text-xs text-fg-3">Tertiary — hints and timestamps.</p>
        <code className="mt-2 inline-block rounded-sm bg-code-bg px-2 py-1 text-code">const mono = 'code font';</code>
      </Card>
      <Card>
        <CardHeader title="Buttons" />
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button><Button variant="link">Link</Button><Button loading>Loading</Button><Button disabled>Disabled</Button>
          <Button size="sm">Small</Button><Button size="lg">Large</Button><IconButton label="Add" icon={<Plus size={16} />} /><IconButton label="Delete" variant="danger" icon={<Trash2 size={16} />} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Form controls" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Text input" hint="Helpful hint"><Input placeholder="Placeholder" /></Field>
          <Field label="With error" error="This field is required"><Input /></Field>
          <Field label="Select"><Select><option>One</option><option>Two</option></Select></Field>
          <Field label="Textarea" optional><Textarea /></Field>
          <div className="flex items-center gap-2"><Checkbox id="ds-c" defaultChecked /><label htmlFor="ds-c" className="text-sm">Checkbox</label></div>
          <SwitchRow label="Switch" description="With description" defaultChecked />
          <PasswordStrength score={3} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Feedback" />
        <div className="flex flex-col gap-3">
          <Banner tone="info" title="Info">Something you should know.</Banner>
          <Banner tone="success" title="Success">It worked.</Banner>
          <Banner tone="warning" title="Warning" onDismiss={() => undefined}>Dismissible warning.</Banner>
          <Banner tone="critical" title="Critical">Something is broken.</Banner>
          <div className="flex flex-wrap items-center gap-2"><Badge>Neutral</Badge><Badge tone="accent">New</Badge><Badge tone="success">Fast</Badge><Badge tone="warning">Beta</Badge><Badge tone="danger">Deprecated</Badge><Badge tone="info">Vision</Badge><Spinner /><Kbd>Ctrl</Kbd><Kbd>K</Kbd></div>
          <Meter label="Storage (82%)" value={82} max={100} format={(n) => `${n} GB`} />
          <Meter label="Storage (97%)" value={97} max={100} />
          <Skeleton className="h-6 w-1/2" />
          <LockedFeature title="Code Mode" reason="Verify your email to unlock this feature." action={<Button size="sm" variant="secondary">Resend email</Button>} />
          <EmptyState icon={<Inbox size={32} />} title="No chats yet" description="Start a conversation to see it here." action={<Button>New chat</Button>} />
          <div className="flex gap-2"><Button variant="secondary" onClick={() => toast.success('Saved', 'Your changes are live.')}>Show toast</Button><Button variant="secondary" onClick={() => toast({ title: 'Chat deleted', action: { label: 'Undo', onClick: () => toast({ title: 'Restored' }) } })}>Toast with undo</Button><Button variant="danger" onClick={() => setConfirm(true)}>Confirm dialog</Button></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Navigation & identity" />
        <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">First</TabsTrigger><TabsTrigger value="b">Second</TabsTrigger></TabsList><TabsContent value="a">First panel</TabsContent><TabsContent value="b">Second panel</TabsContent></Tabs>
        <div className="mt-4 flex gap-2"><Avatar name="Ada Lovelace" size={40} /><Avatar name="Grace Hopper" size={40} /><Avatar name="Alan Turing" size={40} /></div>
      </Card>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete everything?" description="This cannot be undone." destructive confirmText="DELETE" confirmLabel="Delete" onConfirm={() => { toast({ title: 'Deleted' }); }} />
    </div>
  );
}
