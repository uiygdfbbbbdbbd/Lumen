import { useEffect, useState } from 'react';
import { Button, Card, CardHeader, Field, Select, SwitchRow, Textarea, toast } from '@lumen/ui';
import { estimateTokens } from '@lumen/llm';
import { StylesCard } from './StylesCard.js';
import { ModelSelector } from '../models/ModelSelector.js';
import { usePreferences, useUpdatePreferences } from '../models/useModels.js';

function InstructionsCard() {
  const { data: prefs } = usePreferences();
  const update = useUpdatePreferences();
  const [text, setText] = useState('');
  useEffect(() => setText(prefs?.customInstructions ?? ''), [prefs?.customInstructions]);
  return (
    <Card>
      <CardHeader title="Custom instructions" description="Applied to every new chat. Per-chat instructions (in a chat’s menu) take precedence." />
      <Field label="What should the assistant know or do?" hint={`${text.length}/8000 characters · ~${estimateTokens(text)} tokens`}>
        <Textarea value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} className="min-h-32" placeholder="e.g. I’m a data engineer; prefer Python and SQL examples. Keep answers short." />
      </Field>
      <div className="mt-3 flex justify-end"><Button onClick={() => update.mutate({ customInstructions: text }, { onSuccess: () => toast.success('Instructions saved') })} loading={update.isPending}>Save instructions</Button></div>
    </Card>
  );
}

export function ChatSettings() {
  const { data: prefs } = usePreferences();
  const update = useUpdatePreferences();
  const save = (patch: Parameters<typeof update.mutate>[0]) => update.mutate(patch, { onSuccess: () => toast.success('Saved') });
  return (
    <>
      <InstructionsCard />
      <StylesCard />
      <Card>
        <CardHeader title="Default model" description="Used for new chats. You can switch per conversation." />
        <ModelSelector allowAuto value={prefs?.defaultModel ?? 'auto'} onChange={(id) => save({ defaultModel: id })} />
      </Card>
      <Card>
        <CardHeader title="Behavior" />
        <div className="flex max-w-md flex-col gap-2">
          <Field label="Thinking effort" hint="For models that can reason before answering. Higher is slower but more careful.">
            <Select value={prefs?.thinkingEffort ?? 'off'} onChange={(e) => save({ thinkingEffort: e.target.value as 'off' | 'low' | 'medium' | 'high' })}>
              <option value="off">Off</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <SwitchRow label="Send with Enter" description="When off, Enter adds a new line and Ctrl/Cmd+Enter sends." checked={prefs?.sendWithEnter ?? true} onCheckedChange={(v) => save({ sendWithEnter: v })} />
          <SwitchRow label="Auto-title chats" description="Name new chats from their first message." checked={prefs?.autoTitle ?? true} onCheckedChange={(v) => save({ autoTitle: v })} />
          <SwitchRow label="Show suggested prompts" checked={prefs?.showSuggestions ?? true} onCheckedChange={(v) => save({ showSuggestions: v })} />
        </div>
      </Card>
    </>
  );
}
