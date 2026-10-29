/**
 * Roles and permissions. The Hub checks permissions on every protected route; the app uses the same
 * list (from GET /api/me) only to decide what to show. See docs/USERS-AND-ADMIN.md §3.
 */
export const ROLES = ['admin', 'member', 'kid'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'users.manage', // create, edit, disable users; sign devices out
  'audit.view',
  'keys.manage', // Phase 2: service keys vault
  'subwave.control', // Phase 2: SUB/WAVE admin routes through the Hub
  'requests.create',
  'requests.approve', // Phase 3
  'downloads.run', // Phase 3: download without approval
  'library.edit', // Phase 5: tag editor
  'server.view', // Phase 6: server page
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BY_ROLE: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  member: ['requests.create'],
  kid: ['requests.create'],
};

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** A member with the admin-set Autodownload switch may download without approval. Kids never can. */
export function permissionsFor(user: { role: Role; autodownload: boolean }): Permission[] {
  const perms = new Set<Permission>(BY_ROLE[user.role]);
  if (user.autodownload && user.role === 'member') perms.add('downloads.run');
  return [...perms];
}
