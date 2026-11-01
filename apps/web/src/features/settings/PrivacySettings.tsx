import { useState } from 'react';
import { Banner, Button, Card, CardHeader, Dialog, DialogContent, Field, Input, toast } from '@lumen/ui';
import { Download } from 'lucide-react';
import { api, errorMessage } from '../../lib/api.js';
import { useMe, useSetMe, type MeResponse } from '../../lib/auth.js';

export function PrivacySettings() {
  const { data: me } = useMe();
  const setMe = useSetMe();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = me?.user.deletionScheduledFor;

  async function exportData() {
    setExporting(true);
    try {
      const blob = await api<Blob>('/api/me/export');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lumen-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader title="Your data" description="Lumen does not train models on your data. Messages are sent only to the model provider you choose for each chat." />
        <Button variant="secondary" onClick={exportData} loading={exporting}><Download size={16} aria-hidden="true" /> Export my data (.zip)</Button>
      </Card>
      <Card>
        <CardHeader title="Delete account" description="Your account is deactivated immediately and permanently deleted after a grace period. Sign in before then to cancel." />
        {pending ? (
          <Banner tone="warning" title="Deletion scheduled" action={<Button size="sm" variant="secondary" onClick={async () => setMe(await api<MeResponse>('/api/me/delete/cancel', { method: 'POST' }))}>Cancel deletion</Button>}>
            Your account will be deleted on {new Date(pending).toLocaleDateString()}.
          </Banner>
        ) : (
          <Button variant="danger" onClick={() => setOpen(true)} disabled={me?.user.role === 'super_admin'}>Delete my account</Button>
        )}
        {me?.user.role === 'super_admin' ? <p className="mt-2 text-xs text-fg-3">Transfer the super admin role to someone else first.</p> : null}
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Delete your account?" description="All chats, files and settings will be removed when the grace period ends.">
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try { setMe(await api<MeResponse>('/api/me/delete', { method: 'POST', body: { password: pw, confirm: 'DELETE' } })); setOpen(false); }
            catch (err) { setError(errorMessage(err)); }
          }}>
            {error ? <Banner tone="critical">{error}</Banner> : null}
            <Field label="Password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label={<>Type <strong>DELETE</strong> to confirm</>}><Input value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" type="submit" disabled={typed !== 'DELETE'}>Delete account</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
