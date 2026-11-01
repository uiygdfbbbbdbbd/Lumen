import { useCallback, useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, Trash2 } from 'lucide-react';
import { Avatar, Button, Dialog, DialogContent } from '@lumen/ui';

export interface AvatarSelection {
  file: File;
  crop: Area;
  previewUrl: string;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Pick, crop and zoom an avatar locally. Cropping happens client-side for preview, and the crop
 * rectangle is sent with the original file; the server re-encodes and applies it.
 */
export function AvatarPicker({
  name,
  currentUrl,
  value,
  onChange,
  onRemove,
}: {
  name: string;
  currentUrl?: string | null;
  value: AvatarSelection | null;
  onChange: (v: AvatarSelection | null) => void;
  onRemove?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);

  const onFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!ACCEPT.split(',').includes(file.type)) return setError('Use a PNG, JPEG, WebP, GIF or AVIF image.');
    if (file.size > MAX_BYTES) return setError('Images must be 8 MB or smaller.');
    setSource({ file, url: URL.createObjectURL(file) });
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  };

  const onCropComplete = useCallback((_a: Area, pixels: Area) => setArea(pixels), []);

  async function confirm() {
    if (!source || !area) return;
    const img = new Image();
    img.src = source.url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    canvas.getContext('2d')?.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, 256, 256);
    const url = canvas.toDataURL('image/webp', 0.85);
    setPreview(url);
    onChange({ file: source.file, crop: area, previewUrl: url });
    setSource(null);
  }

  const shown = value?.previewUrl ?? preview ?? currentUrl ?? null;

  return (
    <div className="flex items-center gap-4">
      <Avatar src={shown} name={name || 'You'} size={72} />
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            <Camera size={14} aria-hidden="true" /> {shown ? 'Change photo' : 'Add photo'}
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPreview(null);
                onChange(null);
                onRemove?.();
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-fg-3">Optional. We generate an initials avatar if you skip this.</p>
        {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose profile photo" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <Dialog open={Boolean(source)} onOpenChange={(o) => !o && setSource(null)}>
        <DialogContent title="Crop your photo" description="Drag to reposition, use the slider or scroll to zoom.">
          <div className="relative h-72 w-full overflow-hidden rounded-md bg-black">
            {source ? (
              <Cropper image={source.url} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
            ) : null}
          </div>
          <label className="mt-4 flex items-center gap-3 text-sm text-fg-2">
            Zoom
            <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-[var(--lm-accent)]" aria-label="Zoom" />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSource(null)}>Cancel</Button>
            <Button onClick={confirm} disabled={!area}>Use photo</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export async function uploadAvatar(sel: AvatarSelection, apiFn: (path: string, opts: { method: 'POST'; body: FormData }) => Promise<unknown>) {
  const fd = new FormData();
  fd.append('crop', JSON.stringify(sel.crop));
  fd.append('file', sel.file);
  return apiFn('/api/me/avatar', { method: 'POST', body: fd });
}
