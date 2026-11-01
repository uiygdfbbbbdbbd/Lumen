import { describe, expect, it } from 'vitest';
import { can, canAssignRole, canManageUser, hasRoleAtLeast, PERMISSIONS, permissionsFor, ROLES, roleRank } from '../src/index.js';

describe('policy', () => {
  it('users have no admin permissions', () => {
    for (const p of PERMISSIONS) expect(can('user', p)).toBe(false);
  });
  it('super_admin has every permission', () => {
    for (const p of PERMISSIONS) expect(can('super_admin', p)).toBe(true);
  });
  it('moderators can moderate but not edit providers', () => {
    expect(can('moderator', 'moderation:act')).toBe(true);
    expect(can('moderator', 'admin:providers:write')).toBe(false);
  });
  it('only super_admin assigns roles or rotates secrets', () => {
    expect(can('admin', 'admin:roles:assign')).toBe(false);
    expect(can('admin', 'admin:secrets:rotate')).toBe(false);
  });
  it('rank ordering', () => {
    expect(ROLES.map(roleRank)).toEqual([0, 1, 2, 3]);
    expect(hasRoleAtLeast('admin', 'moderator')).toBe(true);
    expect(hasRoleAtLeast('moderator', 'admin')).toBe(false);
  });
  it('permissionsFor returns a copy', () => {
    const p = permissionsFor('admin');
    p.push('admin:roles:assign');
    expect(can('admin', 'admin:roles:assign')).toBe(false);
  });
  it('canAssignRole', () => {
    const sa = { id: 'a', role: 'super_admin' as const };
    expect(canAssignRole(sa, { id: 'b', role: 'user' }, 'admin')).toBe(true);
    expect(canAssignRole(sa, sa, 'user')).toBe(false);
    expect(canAssignRole({ id: 'c', role: 'admin' }, { id: 'b', role: 'user' }, 'moderator')).toBe(false);
  });
  it('canManageUser', () => {
    const admin = { id: 'a', role: 'admin' as const };
    expect(canManageUser(admin, { id: 'b', role: 'user' })).toBe(true);
    expect(canManageUser(admin, { id: 'b', role: 'admin' })).toBe(false);
    expect(canManageUser(admin, admin)).toBe(false);
    expect(canManageUser({ id: 's', role: 'super_admin' }, { id: 'b', role: 'admin' })).toBe(true);
    expect(canManageUser({ id: 'm', role: 'moderator' }, { id: 'b', role: 'user' })).toBe(false);
  });
});
