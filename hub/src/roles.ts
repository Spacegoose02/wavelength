/**
 * Roles and permissions. The Hub checks permissions on every protected route; the app uses the same
 * list (from GET /api/me) only to decide what to show. See docs/USERS-AND-ADMIN.md §3.
 */
export const ROLES = ['admin', 'member', 'kid'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'users.manage', // create, edit, disable users; sign devices out
  'audit.view',
  'keys.manage', // server logins kept by the Hub (services.ts)
  'subwave.control', // Phase 2: SUB/WAVE admin routes through the Hub
  'requests.create',
  'requests.approve', // Phase 3
  'downloads.run', // Phase 3: download without approval
  'library.edit', // kid-safe flags; Phase 5: tag editor
  'server.view', // Phase 6: server page
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BY_ROLE: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  member: ['requests.create'],
  kid: ['requests.create'],
};

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/**
 * What a family may get (families.ts, set by the Hub admin per family):
 * - `person`: each person's own settings (Autodownload or requesting), as without families
 * - `auto`: every grown-up member downloads straight away, Autodownload or not
 * - `request`: everyone requests, even with Autodownload
 * - `off`: nobody in it requests or downloads
 * Kids never download without approval, and admins aren't held by their family's rule.
 */
export const FAMILY_DOWNLOADS = ['person', 'auto', 'request', 'off'] as const;
export type FamilyDownloads = (typeof FAMILY_DOWNLOADS)[number];
export const isFamilyDownloads = (v: unknown): v is FamilyDownloads => typeof v === 'string' && (FAMILY_DOWNLOADS as readonly string[]).includes(v);

/**
 * A member with the admin-set Autodownload switch may download without approval. Kids never can.
 * Their family's download rule (`familyDownloads`) can widen or narrow that.
 */
export function permissionsFor(user: { role: Role; autodownload: boolean; familyDownloads?: FamilyDownloads }): Permission[] {
  const perms = new Set<Permission>(BY_ROLE[user.role]);
  const rule = user.role === 'admin' ? 'person' : (user.familyDownloads ?? 'person');
  if (rule === 'off') perms.delete('requests.create');
  else if (user.role === 'member' && (rule === 'auto' || (rule === 'person' && user.autodownload))) perms.add('downloads.run');
  return [...perms];
}
