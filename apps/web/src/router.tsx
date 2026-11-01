import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Link, Outlet, redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Button, Toaster, TooltipProvider } from '@lumen/ui';
import { meQueryOptions } from './lib/auth.js';
import { AuthLayout } from './features/auth/AuthLayout.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { SignupPage } from './features/auth/SignupPage.js';
import { ConfirmEmailChangePage, ForgotPasswordPage, MagicLinkPage, ResetPasswordPage, VerifyEmailPage } from './features/auth/TokenPages.js';
import { OnboardingPage } from './features/onboarding/OnboardingPage.js';
import { AppShell } from './features/shell/AppShell.js';
import { SettingsLayout } from './features/settings/SettingsLayout.js';
import { ProfileSettings } from './features/settings/ProfileSettings.js';
import { SecuritySettings } from './features/settings/SecuritySettings.js';
import { AppearanceSettings } from './features/settings/AppearanceSettings.js';
import { UsageSettings } from './features/settings/UsageSettings.js';
import { PrivacySettings } from './features/settings/PrivacySettings.js';
import { DesignSystemPage } from './features/design-system/DesignSystemPage.js';
import { ChatSettings } from './features/settings/ChatSettings.js';
import { ShortcutSettings } from './features/settings/ShortcutSettings.js';
import { AdminLayout } from './features/admin/AdminLayout.js';
import { ProvidersPage } from './features/admin/ProvidersPage.js';
import { ModelsPage } from './features/admin/ModelsPage.js';

interface Ctx {
  queryClient: QueryClient;
}

function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl font-bold text-accent">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-fg-2">The page you’re looking for doesn’t exist or moved.</p>
      <Button asChild><Link to="/">Go home</Link></Button>
    </div>
  );
}

function ErrorPage({ error }: { error: unknown }) {
  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-5xl font-bold text-danger">500</p>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-fg-2">{error instanceof Error ? error.message : 'Unexpected error'}</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  );
}

const root = createRootRouteWithContext<Ctx>()({
  component: () => (
    <TooltipProvider>
      <Outlet />
      <Toaster />
    </TooltipProvider>
  ),
  notFoundComponent: NotFound,
  errorComponent: ErrorPage,
});

const guest = createRoute({
  getParentRoute: () => root,
  id: 'guest',
  component: AuthLayout,
});
const loginRoute = createRoute({
  getParentRoute: () => guest,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s.redirect === 'string' ? { redirect: s.redirect } : {}),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (me) throw redirect({ to: '/' });
  },
  component: LoginPage,
});
const signupRoute = createRoute({
  getParentRoute: () => guest,
  path: '/signup',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (me) throw redirect({ to: '/' });
  },
  component: SignupPage,
});
const tokenSearch = (s: Record<string, unknown>): { token?: string } => (typeof s.token === 'string' ? { token: s.token } : {});
const forgotRoute = createRoute({ getParentRoute: () => guest, path: '/forgot-password', component: ForgotPasswordPage });
const resetRoute = createRoute({ getParentRoute: () => guest, path: '/reset-password', validateSearch: tokenSearch, component: ResetPasswordPage });
const verifyRoute = createRoute({ getParentRoute: () => guest, path: '/verify-email', validateSearch: tokenSearch, component: VerifyEmailPage });
const magicRoute = createRoute({ getParentRoute: () => guest, path: '/magic-link', validateSearch: tokenSearch, component: MagicLinkPage });
const emailChangeRoute = createRoute({ getParentRoute: () => guest, path: '/confirm-email-change', validateSearch: tokenSearch, component: ConfirmEmailChangePage });

const authed = createRoute({
  getParentRoute: () => root,
  id: 'authed',
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions);
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
    return { me };
  },
});
const onboardingRoute = createRoute({ getParentRoute: () => authed, path: '/onboarding', component: OnboardingPage });
const shell = createRoute({
  getParentRoute: () => authed,
  id: 'shell',
  beforeLoad: ({ context }) => {
    const me = (context as unknown as { me: { user: { onboarding: { completed: boolean } } } }).me;
    if (!me.user.onboarding.completed) throw redirect({ to: '/onboarding' });
  },
  component: AppShell,
});
// The chat UI (markdown, math, highlighting) is code-split so sign-in and settings load fast.
const ChatPageLazy = lazyRouteComponent(() => import('./features/chat/ChatPage.js'), 'ChatPage');
const homeRoute = createRoute({
  getParentRoute: () => shell,
  path: '/',
  validateSearch: (s: Record<string, unknown>): { tour?: '1' } => (s.tour === '1' ? { tour: '1' } : {}),
  component: ChatPageLazy,
});
const chatRoute = createRoute({ getParentRoute: () => shell, path: '/c/$conversationId', component: ChatPageLazy });
const TemporaryChat = lazyRouteComponent(() => import('./features/chat/TemporaryChat.js'), 'TemporaryChat');
const temporaryRoute = createRoute({ getParentRoute: () => shell, path: '/temporary', component: TemporaryChat });
const settingsRoute = createRoute({ getParentRoute: () => shell, path: '/settings', component: SettingsLayout });
const settingsIndex = createRoute({ getParentRoute: () => settingsRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/settings/account' }); } });
const accountRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/account', component: ProfileSettings });
const securityRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/security', component: SecuritySettings });
const appearanceRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/appearance', component: AppearanceSettings });
const chatSettingsRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/chat', component: ChatSettings });
const shortcutsRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/shortcuts', component: ShortcutSettings });
const usageRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/usage', component: UsageSettings });
const privacyRoute = createRoute({ getParentRoute: () => settingsRoute, path: '/privacy', component: PrivacySettings });
const designRoute = createRoute({ getParentRoute: () => shell, path: '/design-system', component: DesignSystemPage });
const adminRoute = createRoute({
  getParentRoute: () => shell,
  path: '/admin',
  beforeLoad: ({ context }) => {
    const me = (context as unknown as { me: { permissions: string[] } }).me;
    if (!me.permissions.includes('admin:access')) throw redirect({ to: '/' });
  },
  component: AdminLayout,
});
const adminIndex = createRoute({ getParentRoute: () => adminRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/admin/providers' }); } });
const adminProviders = createRoute({ getParentRoute: () => adminRoute, path: '/providers', component: ProvidersPage });
const adminModels = createRoute({ getParentRoute: () => adminRoute, path: '/models', component: ModelsPage });

const routeTree = root.addChildren([
  guest.addChildren([loginRoute, signupRoute, forgotRoute, resetRoute, verifyRoute, magicRoute, emailChangeRoute]),
  authed.addChildren([
    onboardingRoute,
    shell.addChildren([homeRoute, chatRoute, temporaryRoute, settingsRoute.addChildren([settingsIndex, accountRoute, securityRoute, appearanceRoute, chatSettingsRoute, shortcutsRoute, usageRoute, privacyRoute]), designRoute, adminRoute.addChildren([adminIndex, adminProviders, adminModels])]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', defaultPreloadStaleTime: 0 });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
