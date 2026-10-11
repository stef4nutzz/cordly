export type SettingsPageId =
  | 'profile'
  | 'account'
  | 'privacy'
  | 'connections'
  | 'appearance'
  | 'notifications'
  | 'chat'
  | 'accessibility'
  | 'language'
  | 'shortcuts'
  | 'advanced'
  | 'applications';

export interface SettingsPage {
  id: SettingsPageId;
  label: string;
  section: 'Your account' | 'App settings' | 'Developer';
  keywords: readonly string[];
}

export const SETTINGS_REGISTRY: readonly SettingsPage[] = [
  { id: 'profile', label: 'Profile', section: 'Your account', keywords: ['username', 'display name', 'pronouns', 'avatar', 'banner', 'bio', 'time zone', 'accent'] },
  { id: 'account', label: 'Account', section: 'Your account', keywords: ['email', 'password', 'sessions', 'export', 'delete'] },
  { id: 'privacy', label: 'Privacy', section: 'Your account', keywords: ['direct messages', 'friend requests', 'activity', 'receipts', 'media', 'blocked'] },
  { id: 'connections', label: 'Connections', section: 'Your account', keywords: ['linked accounts', 'github', 'twitch', 'youtube', 'steam', 'reddit'] },
  { id: 'appearance', label: 'Appearance', section: 'App settings', keywords: ['theme', 'oled', 'dark', 'light', 'font', 'layout', 'zoom', 'color'] },
  { id: 'notifications', label: 'Notifications', section: 'App settings', keywords: ['desktop', 'sounds', 'volume', 'unread', 'quiet hours'] },
  { id: 'chat', label: 'Chat', section: 'App settings', keywords: ['links', 'attachments', 'spoilers', 'gif', 'enter', 'clock'] },
  { id: 'accessibility', label: 'Accessibility', section: 'App settings', keywords: ['motion', 'contrast', 'underlines', 'focus', 'animation'] },
  { id: 'language', label: 'Language', section: 'App settings', keywords: ['locale', 'translation', 'english'] },
  { id: 'shortcuts', label: 'Shortcuts', section: 'App settings', keywords: ['keyboard', 'keys', 'navigation'] },
  { id: 'advanced', label: 'Advanced', section: 'App settings', keywords: ['developer mode', 'cache', 'reset'] },
  { id: 'applications', label: 'Applications', section: 'Developer', keywords: ['api tokens', 'bot', 'application'] },
];

export function searchSettings(query: string): SettingsPage[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...SETTINGS_REGISTRY];
  return SETTINGS_REGISTRY
    .map((page) => {
      const haystack = `${page.label} ${page.section} ${page.keywords.join(' ')}`.toLowerCase();
      const score = terms.reduce((total, term) => {
        if (page.label.toLowerCase() === term) return total + 5;
        if (page.label.toLowerCase().startsWith(term)) return total + 3;
        if (haystack.includes(term)) return total + 1;
        return total;
      }, 0);
      return { page, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.page.label.localeCompare(right.page.label))
    .map(({ page }) => page);
}
