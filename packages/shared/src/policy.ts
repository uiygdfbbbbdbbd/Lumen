/** Role-based permission policy. Single source of truth for server checks and UI gating. */
export const ROLES = ['user', 'moderator', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2, super_admin: 3 };

export const PERMISSIONS = [
  'admin:access',
  'admin:users:read',
  'admin:users:write',
  'admin:roles:assign',
  'admin:providers:read',
  'admin:providers:write',
  'admin:settings:read',
  'admin:settings:write',
  'admin:audit:read',
  'admin:analytics:read',
  'admin:secrets:rotate',
  'moderation:read',
  'moderation:act',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, readonly Permission[]> = {
  user: [],
  moderator: ['admin:access', 'admin:users:read', 'moderation:read', 'moderation:act'],
  admin: [
    'admin:access',
    'admin:users:read',
    'admin:users:write',
    'admin:providers:read',
    'admin:providers:write',
    'admin:settings:read',
    'admin:settings:write',
    'admin:audit:read',
    'admin:analytics:read',
    'moderation:read',
    'moderation:act',
  ],
  super_admin: PERMISSIONS,
};

export function roleRank(role: Role): number {
  return RANK[role];
}

export function hasRoleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...GRANTS[role]];
}

/**
 * Whether `actor` may change `target`'s role to `next`.
 * Only super admins assign roles; nobody may change their own role (prevents lockout),
 * and the last super admin cannot be demoted (enforced by the caller with a count).
 */
export function canAssignRole(actor: { id: string; role: Role }, target: { id: string; role: Role }, next: Role): boolean {
  if (!can(actor.role, 'admin:roles:assign')) return false;
  if (actor.id === target.id) return false;
  return ROLES.includes(next);
}

/** Admins may act on users strictly below their own rank (super admins on anyone but themselves). */
export function canManageUser(actor: { id: string; role: Role }, target: { id: string; role: Role }): boolean {
  if (!can(actor.role, 'admin:users:write')) return false;
  if (actor.id === target.id) return false;
  if (actor.role === 'super_admin') return true;
  return RANK[actor.role] > RANK[target.role];
}
