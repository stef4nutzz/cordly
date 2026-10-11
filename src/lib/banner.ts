export function publicBannerUrl(userId: string, version: string | null): string | null {
  return version ? `/api/users/${encodeURIComponent(userId)}/banner?v=${encodeURIComponent(version)}` : null;
}
