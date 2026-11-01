import { createContext, useContext, type ReactNode } from 'react';
import { Banner, Button } from '@lumen/ui';
import { Sparkles } from 'lucide-react';

/** Lets any renderer offer "Fix with AI" for the artifact being shown (only inside a chat). */
export const ArtifactFixContext = createContext<((error: string) => void) | null>(null);

export function RenderError({ title, children, error }: { title: string; children: ReactNode; error?: string }) {
  const fix = useContext(ArtifactFixContext);
  return (
    <div className="p-4">
      <Banner
        tone="critical"
        title={title}
        action={fix ? <Button size="sm" variant="secondary" onClick={() => fix(error ?? (typeof children === 'string' ? children : title))}><Sparkles size={14} aria-hidden="true" /> Fix with AI</Button> : undefined}
      >
        {children}
      </Banner>
    </div>
  );
}
