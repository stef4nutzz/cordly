export function publicAvatarUrl(
  userId: string,
  avatarVersion: string | null | undefined,
): string | null {
  return avatarVersion
    ? `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(avatarVersion)}`
    : null;
}
