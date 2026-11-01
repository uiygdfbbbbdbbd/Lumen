import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { cn } from '@lumen/ui';
import { Boxes, Library, Server } from 'lucide-react';

const NAV = [
  { to: '/admin/providers', label: 'Providers', icon: <Server size={16} /> },
  { to: '/admin/models', label: 'Models', icon: <Boxes size={16} /> },
  { to: '/admin/rag', label: 'Knowledge & RAG', icon: <Library size={16} /> },
] as const;

export function AdminLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row">
      <nav aria-label="Admin" className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col">
        <h1 className="mb-2 hidden px-3 text-lg font-semibold md:block">Admin</h1>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} aria-current={path.startsWith(n.to) ? 'page' : undefined} className={cn('flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm', path.startsWith(n.to) ? 'bg-accent-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover')}>
            <span aria-hidden="true">{n.icon}</span>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Outlet />
      </div>
    </div>
  );
}
