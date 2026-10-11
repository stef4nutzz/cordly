'use client';

import Image from 'next/image';
import { io, type Socket } from 'socket.io-client';
import {
  Activity, Ban, Bell, Check, ChevronDown, Compass, Copy, Crown, Flag, FolderPlus, Hash, Image as ImageIcon,
  Link as LinkIcon, LogOut, MessageSquare, Paperclip, Pencil, Pin, Reply, Search, Settings, Shield, Smile,
  Star, Sticker, ThumbsUp, Trash2, UserPlus, Users, Webhook, X,
} from 'lucide-react';
import { FormEvent, MouseEvent, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COMMUNITY_TERMS } from '@/lib/community-terms';
import { ColorInput, FormField, Menu, MenuItem, Modal, Select, Slider, Toggle } from '@/components/ui';
import { useTheme } from '@/components/theme-provider';
import { SETTINGS_REGISTRY, searchSettings, type SettingsPageId } from '@/lib/settings-registry';
import { matchesMessageSearch } from '@/lib/message-search';
import type { RealtimeClientEvents, RealtimeMessage, RealtimeRoom, RealtimeServerEvents } from '@/lib/realtime/protocol';

type Account = {
  id: string;
  username: string;
  displayName?: string;
  tag: string;
  pronouns?: string;
  bio?: string;
  timezoneOffset?: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
  platformRole: string;
  avatarUrl: string | null;
  bannerUrl?: string | null;
  email?: string;
  createdAt?: string | null;
  twoFactorEnabled?: boolean;
};

type Guild = { id: string; name: string; inviteCode: string; detachedBanner?: boolean };
type Channel = { id: string; name: string; type: 'text'; categoryId?: string | null };
type CommunityCategory = { id: string; name: string };
type CommunitySettingsPage = 'overview' | 'roles' | 'moderation' | 'activity' | 'emoji' | 'stickers' | 'discovery' | 'webhooks' | 'members' | 'invites' | 'bans';
type MessageAttachment = { id: string; filename: string; contentType: string; size: number; url: string };
type MessageReaction = { emoji: string; count: number; reacted: boolean };
type ChatMessage = RealtimeMessage;
type ContextMenuState =
  | { kind: 'message'; x: number; y: number; message: ChatMessage; direct: boolean }
  | { kind: 'user' | 'self'; x: number; y: number; user: { id: string; username: string; tag: string } };
type ContextMenuInput =
  | { kind: 'message'; message: ChatMessage; direct: boolean }
  | { kind: 'user' | 'self'; user: { id: string; username: string; tag: string } };
type ActiveSession = { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastUsedAt: string | null; expiresAt: string; current: boolean };
type CommunityMember = {
  id: string;
  username: string;
  displayName: string;
  tag: string;
  pronouns: string;
  bio: string;
  timezoneOffset: string;
  status: Account['status'];
  avatarUrl: string | null;
  role: 'owner' | 'member';
  owner: boolean;
  joinedAt: string;
};
type UserProfileView = {
  id: string;
  username: string;
  displayName: string;
  tag: string;
  pronouns: string;
  bio: string;
  timezoneOffset: string;
  status: Account['status'];
  platformRole: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accountCreatedAt: string;
  isFriend: boolean;
  friendRequestPending: boolean;
  canAcceptFriendRequest: boolean;
  community: { name: string; role: 'owner' | 'member'; joinedAt: string } | null;
  mutualCommunities: Array<{ id: string; name: string }>;
  mutualFriends: Array<{ id: string; username: string; tag: string; avatarUrl: string | null }>;
};
type ProfileTab = 'overview' | 'friends' | 'communities';
type AppProfile = {
  displayName: string;
  pronouns: string;
  bio: string;
  timezone: string;
  accentColor: string;
  primaryColor: string;
  secondaryColor: string;
};
type AppPreferences = {
  appearance: {
    theme: 'oled' | 'dark' | 'light' | 'system';
    messageLayout: 'cozy' | 'compact';
    fontSize: number;
    groupSpacing: number;
    zoom: number;
    roleColors: boolean;
    saturation: number;
  };
  notifications: {
    desktopPush: boolean;
    sounds: boolean;
    soundVolume: number;
    unreadBadges: boolean;
    quietHours: boolean;
  };
  privacy: {
    directMessages: 'everyone' | 'friends' | 'nobody';
    friendRequests: 'everyone' | 'mutuals' | 'nobody';
    explicitMediaFilter: boolean;
    showActivity: boolean;
    readReceipts: boolean;
  };
  chat: {
    linkPreviews: boolean;
    inlineAttachments: boolean;
    convertEmoticons: boolean;
    hideSpoilers: boolean;
    gifAutoplay: boolean;
    sendOnEnter: boolean;
    clockFormat: '12h' | '24h';
  };
  accessibility: {
    reducedMotion: boolean;
    highContrast: boolean;
    underlineLinks: boolean;
    keyboardFocus: boolean;
    animatedEmoji: boolean;
  };
  language: string;
  developerMode: boolean;
};
function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const messagesById = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messagesById.set(message.id, message);
  return [...messagesById.values()].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt) || first.id.localeCompare(second.id),
  );
}
function reconcileRecentChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  if (!incoming.length) return [];
  const firstFetchedAt = incoming[0].createdAt;
  const lastFetchedAt = incoming.at(-1)?.createdAt ?? firstFetchedAt;
  return mergeChatMessages(
    current.filter((message) => message.createdAt < firstFetchedAt || message.createdAt > lastFetchedAt),
    incoming,
  );
}
function rememberChatMessages(cache: Map<string, ChatMessage[]>, key: string, messages: ChatMessage[]) {
  cache.delete(key);
  cache.set(key, messages.slice(-100));
  if (cache.size > 40) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}
type FriendRelation = {
  id: string;
  status: 'pending' | 'accepted';
  incoming: boolean;
  user: {
    id: string;
    username: string;
    tag: string;
    status: Account['status'];
    avatarUrl: string | null;
  };
};
type DirectConversation = {
  id: string;
  updatedAt: string;
  lastMessage: { id: string; content: string; createdAt: string; authorId: string } | null;
  user: FriendRelation['user'];
};

type ApiError = Error & { fields?: Record<string, string[]> };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  const result: unknown = await response.json();
  if (!response.ok) {
    const body = result as { error?: string; fields?: Record<string, string[]> };
    const error = new Error(body.error ?? 'The request could not be completed.') as ApiError;
    error.fields = body.fields;
    throw error;
  }
  return result as T;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function initials(value: string) {
  return value.slice(0, 2).toUpperCase();
}

function profileLocalTime(offset: string) {
  const match = offset.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/);
  const offsetMinutes = match
    ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : 0;
  const now = new Date();
  const localOffsetMinutes = -now.getTimezoneOffset();
  const profileTime = new Date(now.getTime() + (offsetMinutes - localOffsetMinutes) * 60_000);
  const difference = offsetMinutes - localOffsetMinutes;
  const hours = Math.floor(Math.abs(difference) / 60);
  const minutes = Math.abs(difference) % 60;
  const relative = difference === 0
    ? 'Same time as you'
    : `${hours ? `${hours} hour${hours === 1 ? '' : 's'}` : ''}${hours && minutes ? ' ' : ''}${minutes ? `${minutes} min` : ''} ${difference > 0 ? 'ahead of' : 'behind'} you`;
  return `${profileTime.toLocaleTimeString([], { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' })} · ${relative}`;
}

const inputClass =
  'mt-1.5 w-full rounded-xl border border-white/10 bg-[#11141b] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/15';
const buttonClass =
  'rounded-xl bg-[#5865f2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50';

function UserAvatar({
  username,
  avatarUrl,
  sizeClass,
  status,
}: {
  username: string;
  avatarUrl: string | null;
  sizeClass: string;
  status?: Account['status'];
}) {
  const statusClass =
    status === 'online'
      ? 'bg-emerald-400'
      : status === 'idle'
        ? 'bg-amber-300'
        : status === 'dnd'
          ? 'bg-rose-500'
          : 'bg-slate-500';
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-[#5865f2] font-semibold text-white ${sizeClass}`}>
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt=""
          fill
          sizes="56px"
          unoptimized
          className="rounded-full object-cover"
        />
      ) : (
        initials(username)
      )}
      {status && <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#292b2f] ${statusClass}`} />}
    </span>
  );
}

function MessageContent({
  content,
  onMemberMention,
}: {
  content: string;
  onMemberMention: (username: string) => void;
}) {
  const codeSections = content.split(/```([\s\S]*?)```/g);
  const inline = (text: string, prefix: string) => {
    const pattern = /(\|\|[\s\S]+?\|\||`[^`]+`|\*\*[^*]+\*\*|@(everyone|here|[\w.-]+)|#[a-z0-9-]+|https?:\/\/[^\s<]+)/gi;
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > last) parts.push(text.slice(last, index));
      const value = match[0];
      if (value.startsWith('||')) {
        parts.push(<details key={`${prefix}-${index}`} className="inline"><summary className="inline cursor-pointer rounded bg-cordly-active px-1 text-cordly-muted">Spoiler</summary><span className="ml-1 rounded bg-cordly-active px-1">{value.slice(2, -2)}</span></details>);
      } else if (value.startsWith('`')) {
        parts.push(<code key={`${prefix}-${index}`} className="rounded bg-cordly-elevated px-1 py-0.5 font-mono text-[0.9em]">{value.slice(1, -1)}</code>);
      } else if (value.startsWith('**')) {
        parts.push(<strong key={`${prefix}-${index}`} className="font-semibold">{value.slice(2, -2)}</strong>);
      } else if (value.startsWith('@')) {
        const label = value.slice(1);
        parts.push(<button key={`${prefix}-${index}`} type="button" onClick={() => onMemberMention(label)} className="rounded bg-cordly-accent/20 px-1 text-indigo-200 hover:bg-cordly-accent/30">{value}</button>);
      } else if (value.startsWith('#')) {
        parts.push(<span key={`${prefix}-${index}`} className="rounded bg-cordly-accent/20 px-1 text-indigo-200">{value}</span>);
      } else {
        let href: string | null = null;
        try {
          const url = new URL(value);
          if (url.protocol === 'http:' || url.protocol === 'https:') href = url.toString();
        } catch {
          href = null;
        }
        parts.push(href ? <a key={`${prefix}-${index}`} href={href} target="_blank" rel="noreferrer noopener" className="text-indigo-300 underline-offset-2 hover:underline">{value}</a> : value);
      }
      last = index + value.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
  return <span>{codeSections.map((section, index) => index % 2 === 1
    ? <pre key={`code-${index}`} className="my-2 overflow-x-auto rounded-card border border-cordly-border bg-cordly-surface p-3 font-mono text-xs leading-5"><code>{section.replace(/^\w*\n/, '')}</code></pre>
    : <span key={`text-${index}`}>{inline(section, `text-${index}`)}</span>)}</span>;
}

function UserAccountPopover({
  account,
  onStatusChange,
  onSwitchAccount,
  onCopyUserId,
  onEditProfile,
}: {
  account: Account;
  onStatusChange: (status: Account['status']) => void;
  onSwitchAccount: () => void;
  onCopyUserId: () => void;
  onEditProfile: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setStatusOpen(false);
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const statusColors: Record<Account['status'], string> = {
    online: 'bg-cordly-success',
    idle: 'bg-cordly-warning',
    dnd: 'bg-cordly-danger',
    offline: 'bg-cordly-muted',
  };

  return (
    <div className="relative min-w-0 flex-1" ref={root}>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-w-0 w-full items-center gap-2 rounded-control p-1 text-left hover:bg-cordly-hover">
        <UserAvatar username={account.username} avatarUrl={account.avatarUrl} sizeClass="h-8 w-8 text-xs" status={account.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{account.username}</span>
          <span className="block truncate text-[10px] text-cordly-muted">#{account.tag} · {account.status}</span>
        </span>
      </button>
      {open && (
        <section role="dialog" aria-label="Your account" className="absolute bottom-[calc(100%+10px)] left-0 z-[90] w-[min(20rem,calc(100vw-5rem))] overflow-hidden rounded-card border border-cordly-border bg-cordly-surface p-3 shadow-2xl">
          <div className="relative mb-3 h-20 rounded-control bg-cordly-elevated">
            <div className="absolute -bottom-5 left-3 rounded-full border-4 border-cordly-surface">
              <UserAvatar username={account.username} avatarUrl={account.avatarUrl} sizeClass="h-14 w-14 text-base" status={account.status} />
            </div>
          </div>
          <div className="px-1 pb-3 pt-6">
            <p className="text-base font-semibold">{account.displayName || account.username}</p>
            <p className="text-xs text-cordly-secondary">{account.username}#{account.tag}</p>
          </div>
          <div className="space-y-1 rounded-card bg-cordly-elevated p-1.5">
            <button type="button" aria-expanded={statusOpen} onClick={() => setStatusOpen((value) => !value)} className="flex w-full items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-xs font-semibold hover:bg-cordly-hover">
              <span className={`h-3 w-3 rounded-full ${statusColors[account.status]}`} />
              <span className="flex-1 capitalize">{account.status === 'dnd' ? 'Do not disturb' : account.status}</span>
              <ChevronDown size={15} className={`-rotate-90 transition-transform ${statusOpen ? 'rotate-0' : ''}`} />
            </button>
            {statusOpen && (
              <div className="grid grid-cols-2 gap-1 px-1 pb-1">
                {(['online', 'idle', 'dnd', 'offline'] as const).map((status) => (
                  <button key={status} type="button" onClick={() => { onStatusChange(status); setStatusOpen(false); }} className="flex items-center gap-2 rounded-control px-2 py-2 text-left text-[11px] capitalize hover:bg-cordly-hover">
                    <span className={`h-2.5 w-2.5 rounded-full ${statusColors[status]}`} />{status === 'dnd' ? 'Do not disturb' : status}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => { setOpen(false); onSwitchAccount(); }} className="flex w-full items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-xs font-semibold hover:bg-cordly-hover"><Users size={15} />Switch account</button>
            <button type="button" onClick={() => { setOpen(false); onCopyUserId(); }} className="flex w-full items-center gap-3 rounded-control px-2.5 py-2.5 text-left text-xs font-semibold hover:bg-cordly-hover"><Copy size={15} />Copy user ID</button>
          </div>
          <button type="button" onClick={() => { setOpen(false); onEditProfile(); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-control bg-cordly-accent px-3 py-2.5 text-xs font-semibold text-white hover:bg-cordly-accent-hover"><Pencil size={14} />Edit profile</button>
        </section>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  channel: Channel;
  active: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className={`group mb-0.5 flex items-center rounded-control text-sm ${active ? 'bg-cordly-active text-cordly-text' : 'text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text'}`}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"><Hash size={15} className="shrink-0 text-cordly-muted" /><span className="truncate">{channel.name}</span></button>
      <button type="button" aria-label={`${favorite ? 'Remove' : 'Add'} ${channel.name} favorite`} title="Toggle favorite" onClick={onToggleFavorite} className={`mr-1 rounded p-1 hover:bg-cordly-active ${favorite ? 'text-cordly-warning' : 'text-cordly-muted opacity-0 group-hover:opacity-100'}`}><Star size={13} /></button>
    </div>
  );
}

export function CordlyClient() {
  const { setTheme } = useTheme();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState('');
  const [toastExiting, setToastExiting] = useState(false);
  const [toastSequence, setToastSequence] = useState(0);
  const [successToast, setSuccessToast] = useState('');
  const [authCodeRequired, setAuthCodeRequired] = useState(false);
  const [authTotpCode, setAuthTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [activeGuildId, setActiveGuildId] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [membersOpen, setMembersOpen] = useState(true);
  const [channelPanel, setChannelPanel] = useState<'threads' | 'pins' | null>(null);
  const [communityMenuOpen, setCommunityMenuOpen] = useState(false);
  const [communityModal, setCommunityModal] = useState<'invite' | 'settings' | 'channel' | 'category' | 'notifications' | 'privacy' | 'profile' | 'leave' | null>(null);
  const [communitySettingsPage, setCommunitySettingsPage] = useState<CommunitySettingsPage>('overview');
  const [communityNameDraft, setCommunityNameDraft] = useState('');
  const [detachedBannerDraft, setDetachedBannerDraft] = useState(false);
  const [communitySettingsSaving, setCommunitySettingsSaving] = useState(false);
  const [inviteExpiry, setInviteExpiry] = useState(24);
  const [inviteMaxUses, setInviteMaxUses] = useState(0);
  const [createdInvite, setCreatedInvite] = useState('');
  const [communityPreferences, setCommunityPreferences] = useState<Record<string, string | boolean | number | string[] | null>>({});
  const [communityProfile, setCommunityProfile] = useState<{ nickname: string; bio: string }>({ nickname: '', bio: '' });
  const [categoryName, setCategoryName] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [memberProfile, setMemberProfile] = useState<UserProfileView | null>(null);
  const [memberProfileLoading, setMemberProfileLoading] = useState(false);
  const [memberProfileFull, setMemberProfileFull] = useState(false);
  const [memberProfileTab, setMemberProfileTab] = useState<ProfileTab>('overview');
  const profileRequestRef = useRef(0);
  const [channelSearch, setChannelSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [channelSearchOpen, setChannelSearchOpen] = useState(false);
  const [favoriteChannels, setFavoriteChannels] = useState<string[]>([]);
  const [settingsPage, setSettingsPage] = useState('profile');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsTag, setSettingsTag] = useState('');
  const [passwordFields, setPasswordFields] = useState({ current: '', next: '' });
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [totpSetup, setTotpSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [profileSettings, setProfileSettings] = useState<AppProfile | null>(null);
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [persistedProfile, setPersistedProfile] = useState<AppProfile | null>(null);
  const [persistedPreferences, setPersistedPreferences] = useState<AppPreferences | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const communityMenuRef = useRef<HTMLDivElement>(null);
  const settingsSearchRef = useRef<HTMLInputElement>(null);
  const profileDialogRef = useRef<HTMLElement>(null);
  const profileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [activeChannelId, setActiveChannelId] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const messageCacheRef = useRef(new Map<string, ChatMessage[]>());
  const activeDmRef = useRef<DirectConversation | null>(null);
  const directConversationsRef = useRef<DirectConversation[]>([]);
  const socketRef = useRef<Socket<RealtimeServerEvents, RealtimeClientEvents> | null>(null);
  const socketConnectedRef = useRef(false);
  const typingTimersRef = useRef(new Map<string, number>());
  const typingStopTimerRef = useRef<number | null>(null);
  const typingByRoomRef = useRef(new Map<string, Map<string, string>>());
  const joinedDmRoomsRef = useRef(new Set<string>());
  const joinedChannelRoomRef = useRef('');
  const [unreadDmIds, setUnreadDmIds] = useState<Set<string>>(() => new Set());
  const [friends, setFriends] = useState<FriendRelation[]>([]);
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([]);
  const dmActivityRef = useRef<Map<string, string>>(new Map());
  const dmActivityInitializedRef = useRef(false);
  const notifyIncomingDmRef = useRef<(conversation: DirectConversation) => void>(() => {});
  const [activeDm, setActiveDm] = useState<DirectConversation | null>(null);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [dmSearchOpen, setDmSearchOpen] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [workspace, setWorkspace] = useState<'servers' | 'friends'>('friends');
  const workspaceRef = useRef(workspace);
  const activeChannelIdRef = useRef(activeChannelId);
  const [socketConnected, setSocketConnected] = useState(false);
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [serverDialogView, setServerDialogView] = useState<'choose' | 'create' | 'join'>('choose');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsUsername, setSettingsUsername] = useState('');
  const [settingsStatus, setSettingsStatus] = useState<Account['status']>('online');
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [friendFilter, setFriendFilter] = useState<'all' | 'online' | 'pending'>('online');
  const [friendSearch, setFriendSearch] = useState('');
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [error, setError] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageAttachments, setMessageAttachments] = useState<MessageAttachment[]>([]);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [typingRoomKey, setTypingRoomKey] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [guildName, setGuildName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [channelName, setChannelName] = useState('');
  const [friendIdentifier, setFriendIdentifier] = useState('');
  const [authForm, setAuthForm] = useState({
    email: '',
    username: '',
    password: '',
    dateOfBirth: '',
    identifier: '',
  });

  useEffect(() => {
    if (!successToast) return;
    const timer = window.setTimeout(() => {
      if (toastExiting) {
        setSuccessToast('');
        setToastExiting(false);
      } else {
        setToastExiting(true);
      }
    }, toastExiting ? 220 : 3000);
    return () => window.clearTimeout(timer);
  }, [successToast, toastExiting, toastSequence]);

  function notifySuccess(message: string) {
    setToastExiting(false);
    setSuccessToast(message);
    setToastSequence((sequence) => sequence + 1);
    setError('');
  }

  function notifyIncomingDm(conversation: DirectConversation) {
    setUnreadDmIds((current) => new Set(current).add(conversation.id));
    if (preferences?.notifications.desktopPush && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(`Message from ${conversation.user.username}`, {
        body: conversation.lastMessage
          ? conversation.lastMessage.content || 'Sent an attachment.'
          : 'You received a direct message.',
      });
      notification.onclick = () => {
        window.focus();
        selectDirectConversation(conversation);
        notification.close();
      };
    }
  }
  notifyIncomingDmRef.current = notifyIncomingDm;

  function dismissSuccessToast() {
    setToastExiting(true);
  }

  const activeGuild = useMemo(
    () => guilds.find((guild) => guild.id === activeGuildId) ?? null,
    [activeGuildId, guilds],
  );
  const activeDmId = activeDm?.id ?? '';
  const profileDialogOpen = memberProfileLoading || memberProfile !== null;
  const closeUserProfile = useCallback(() => {
    profileRequestRef.current += 1;
    setMemberProfile(null);
    setMemberProfileLoading(false);
    setMemberProfileFull(false);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !contextMenuRef.current?.contains(event.target)) setContextMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setContextMenu(null);
    }
    function focusFirstItem() {
      contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', closeOnEscape);
    const focusFrame = window.requestAnimationFrame(focusFirstItem);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', closeOnEscape);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!profileDialogOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    profileCloseButtonRef.current?.focus();
    function handleProfileKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeUserProfile();
      }
    }
    function closeOutsideProfile(event: PointerEvent) {
      if (event.target instanceof Node && !profileDialogRef.current?.contains(event.target)) {
        closeUserProfile();
      }
    }
    document.addEventListener('keydown', handleProfileKeydown);
    document.addEventListener('pointerdown', closeOutsideProfile);
    return () => {
      document.removeEventListener('keydown', handleProfileKeydown);
      document.removeEventListener('pointerdown', closeOutsideProfile);
      previous?.focus();
    };
  }, [closeUserProfile, memberProfileLoading, profileDialogOpen]);
  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [activeChannelId, channels],
  );
  const unreadDmCount = preferences?.notifications.unreadBadges === false ? 0 : unreadDmIds.size;
  const activeTypingRoom = workspace === 'servers'
    ? `channel:${activeChannelId}`
    : `dm:${activeDmId}`;
  const visibleTypingUsers = typingRoomKey === activeTypingRoom ? typingUsers : [];
  const currentCommunityRole = members.find((member) => member.id === account?.id)?.role;
  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    const ordered = [
      ...channels.filter((channel) => favoriteChannels.includes(channel.id)),
      ...channels.filter((channel) => !favoriteChannels.includes(channel.id)),
    ];
    return ordered.filter((channel) => channel.name.includes(query));
  }, [channels, channelSearch, favoriteChannels]);
  useEffect(() => {
    messagesRef.current = messages;
    if (activeDm) {
      rememberChatMessages(messageCacheRef.current, `dm:${activeDm.id}`, messages);
    } else if (workspace === 'servers' && activeChannelId) {
      rememberChatMessages(messageCacheRef.current, `channel:${activeChannelId}`, messages);
    }
  }, [activeChannelId, activeDm, messages, workspace]);
  useEffect(() => {
    activeDmRef.current = activeDm;
  }, [activeDm]);
  useEffect(() => {
    directConversationsRef.current = directConversations;
  }, [directConversations]);
  useEffect(() => {
    workspaceRef.current = workspace;
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId, workspace]);
  useEffect(() => {
    for (const timer of typingTimersRef.current.values()) window.clearTimeout(timer);
    typingTimersRef.current.clear();
    typingByRoomRef.current.clear();
  }, [activeChannelId, activeDmId, workspace]);
  useEffect(() => {
    const socket = socketRef.current;
    if (!socketConnected || !socket) return;
    const nextChannelId = workspace === 'servers' ? activeChannelId : '';
    if (joinedChannelRoomRef.current && joinedChannelRoomRef.current !== nextChannelId) {
      socket.emit('room:leave', { type: 'channel', id: joinedChannelRoomRef.current });
      joinedChannelRoomRef.current = '';
    }
    if (nextChannelId && joinedChannelRoomRef.current !== nextChannelId) {
      socket.emit('room:join', { type: 'channel', id: nextChannelId });
      joinedChannelRoomRef.current = nextChannelId;
    }
    const conversations = new Set(directConversations.slice(0, 100).map((conversation) => conversation.id));
    if (activeDmId) conversations.add(activeDmId);
    for (const conversationId of joinedDmRoomsRef.current) {
      if (!conversations.has(conversationId)) {
        socket.emit('room:leave', { type: 'dm', id: conversationId });
        joinedDmRoomsRef.current.delete(conversationId);
      }
    }
    for (const conversationId of conversations) {
      if (joinedDmRoomsRef.current.has(conversationId)) continue;
      socket.emit('room:join', { type: 'dm', id: conversationId });
      joinedDmRoomsRef.current.add(conversationId);
    }
  }, [activeChannelId, activeDmId, directConversations, socketConnected, workspace]);
  const visibleFriends = friends.filter((relation) => {
    const matchesFilter =
      friendFilter === 'pending'
        ? relation.status === 'pending'
        : friendFilter === 'online'
          ? relation.status === 'accepted' && relation.user.status !== 'offline'
          : true;
    const query = friendSearch.trim().toLowerCase();
    const matchesSearch =
      !query ||
      `${relation.user.username}#${relation.user.tag}`.toLowerCase().includes(query);
    return matchesFilter && matchesSearch;
  });

  const loadGuilds = useCallback(async () => {
    const result = await api<{ guilds: Guild[] }>('/api/guilds');
    setGuilds(result.guilds);
    setActiveGuildId((current) =>
      result.guilds.some((guild) => guild.id === current) ? current : result.guilds[0]?.id ?? '',
    );
  }, []);

  const loadFriends = useCallback(async () => {
    const result = await api<{ friends: FriendRelation[] }>('/api/friends');
    setFriends(result.friends);
  }, []);
  const loadDirectConversations = useCallback(async () => {
    const result = await api<{ conversations: DirectConversation[] }>('/api/dms');
    if (!dmActivityInitializedRef.current) {
      dmActivityRef.current = new Map(result.conversations.map((conversation) => [conversation.id, conversation.lastMessage?.id ?? '']));
      dmActivityInitializedRef.current = true;
    }
    setDirectConversations(result.conversations);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ user: Account | null }>('/api/auth/me')
      .then(async ({ user }) => {
        if (cancelled) return;
        setAccount(user);
        if (user) {
          await Promise.all([loadGuilds(), loadFriends(), loadDirectConversations()]);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadDirectConversations, loadFriends, loadGuilds]);

  useEffect(() => {
    if (!account) return;
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    const updateMessages = (incoming: ChatMessage[]) => {
      setMessages((current) => {
        const next = mergeChatMessages(current, incoming);
        messagesRef.current = next;
        return next;
      });
    };
    socket.on('connect', () => {
      socketConnectedRef.current = true;
      setSocketConnected(true);
    });
    socket.on('disconnect', () => {
      socketConnectedRef.current = false;
      joinedChannelRoomRef.current = '';
      joinedDmRoomsRef.current.clear();
      setSocketConnected(false);
    });
    socket.on('connect_error', (connectionError) => {
      if (connectionError.message === 'Authentication required.') {
        setError('Real-time connection requires a current sign-in. Please sign in again.');
        socket.disconnect();
      }
    });
    socket.on('message:created', (message) => {
      if (workspaceRef.current === 'servers' && activeChannelIdRef.current) updateMessages([message]);
    });
    socket.on('message:updated', (update) => {
      if (workspaceRef.current !== 'servers') return;
      setMessages((current) => {
        const next = current.map((message) => {
          if (message.id !== update.id) return message;
          if (update.action === 'edit') return { ...message, content: update.content ?? message.content, editedAt: update.editedAt ?? message.editedAt };
          if (update.action === 'pin') return { ...message, pinned: update.pinned ?? message.pinned };
          if (update.action !== 'react' || !update.emoji || !update.userId) return message;
          const reactions = [...message.reactions];
          const reactionIndex = reactions.findIndex((reaction) => reaction.emoji === update.emoji);
          const currentReaction = reactionIndex >= 0 ? reactions[reactionIndex] : null;
          const count = Math.max(0, (currentReaction?.count ?? 0) + (update.added ? 1 : -1));
          if (count === 0) reactions.splice(reactionIndex, 1);
          else if (currentReaction) reactions[reactionIndex] = {
            ...currentReaction,
            count,
            reacted: update.userId === account.id ? Boolean(update.added) : currentReaction.reacted,
          };
          else reactions.push({ emoji: update.emoji, count, reacted: update.userId === account.id && Boolean(update.added) });
          return { ...message, reactions };
        });
        messagesRef.current = next;
        return next;
      });
    });
    socket.on('message:deleted', ({ id }) => {
      setMessages((current) => {
        const next = current.filter((message) => message.id !== id);
        messagesRef.current = next;
        return next;
      });
    });
    socket.on('dm:conversation:created', (conversation) => {
      const current = directConversationsRef.current.find((item) => item.id === conversation.id);
      const nextConversation = current
        ? { ...conversation, lastMessage: current.lastMessage, updatedAt: current.updatedAt }
        : conversation;
      directConversationsRef.current = current
        ? [nextConversation, ...directConversationsRef.current.filter((item) => item.id !== conversation.id)]
        : [nextConversation, ...directConversationsRef.current];
      setDirectConversations(directConversationsRef.current);
    });
    socket.on('dm:message:created', ({ conversationId, message }) => {
      const conversation = directConversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation) return;
      const updatedConversation = {
        ...conversation,
        updatedAt: message.createdAt,
        lastMessage: {
          id: message.id,
          content: message.content,
          createdAt: message.createdAt,
          authorId: message.author.id,
        },
      };
      directConversationsRef.current = [
        updatedConversation,
        ...directConversationsRef.current.filter((item) => item.id !== conversationId),
      ];
      setDirectConversations(directConversationsRef.current);
      dmActivityRef.current.set(conversationId, message.id);
      if (workspaceRef.current === 'friends' && activeDmRef.current?.id === conversationId) {
        setActiveDm(updatedConversation);
        updateMessages([message]);
      } else if (message.author.id !== account.id) {
        setUnreadDmIds((current) => new Set(current).add(conversationId));
        notifyIncomingDmRef.current(updatedConversation);
      }
    });
    socket.on('typing:updated', (update) => {
      const isActiveRoom = update.type === 'channel'
        ? workspaceRef.current === 'servers' && activeChannelIdRef.current === update.id
        : workspaceRef.current === 'friends' && activeDmRef.current?.id === update.id;
      if (!isActiveRoom || update.userId === account.id) return;
      const room = `${update.type}:${update.id}`;
      setTypingRoomKey(room);
      const users = typingByRoomRef.current.get(room) ?? new Map<string, string>();
      const timerKey = `${room}:${update.userId}`;
      const oldTimer = typingTimersRef.current.get(timerKey);
      if (oldTimer) window.clearTimeout(oldTimer);
      if (update.active) {
        users.set(update.userId, update.username);
        const timer = window.setTimeout(() => {
          users.delete(update.userId);
          typingTimersRef.current.delete(timerKey);
          const activeRoom = workspaceRef.current === 'servers'
            ? `channel:${activeChannelIdRef.current}`
            : `dm:${activeDmRef.current?.id ?? ''}`;
          if (activeRoom === room) setTypingUsers([...users.values()]);
        }, 5000);
        typingTimersRef.current.set(timerKey, timer);
      } else {
        users.delete(update.userId);
        typingTimersRef.current.delete(timerKey);
      }
      typingByRoomRef.current.set(room, users);
      setTypingUsers([...users.values()]);
    });
    socket.on('presence:updated', (update) => {
      const status = update.online ? update.status : 'offline';
      setFriends((current) => current.map((relation) => relation.user.id === update.userId
        ? { ...relation, user: { ...relation.user, status } }
        : relation));
      setMembers((current) => current.map((member) => member.id === update.userId
        ? { ...member, status }
        : member));
    });
    socket.on('friendship:updated', (update) => {
      void loadFriends().catch((loadError: unknown) => setError(getErrorMessage(loadError)));
      if (update.status === 'accepted') {
        void loadDirectConversations().catch((loadError: unknown) => setError(getErrorMessage(loadError)));
      } else if (update.status === 'pending') {
        notifySuccess(`${update.user.username} sent you a friend request`);
      }
    });
    socket.on('room:error', setError);
    socket.on('session:revoked', () => {
      socket.disconnect();
      setAccount(null);
      setGuilds([]);
      setChannels([]);
      setMessages([]);
      messageCacheRef.current.clear();
      setFriends([]);
      setDirectConversations([]);
      directConversationsRef.current = [];
      setActiveDm(null);
      setError('This session was revoked. Sign in again to continue.');
    });
    const typingTimers = typingTimersRef.current;
    return () => {
      for (const timer of typingTimers.values()) window.clearTimeout(timer);
      typingTimers.clear();
      socket.disconnect();
      socketRef.current = null;
      socketConnectedRef.current = false;
      setSocketConnected(false);
    };
  }, [account, loadDirectConversations, loadFriends]);

  useEffect(() => {
    if (!account || !activeGuildId) {
      return;
    }

    let cancelled = false;
    Promise.all([
      api<{ channels: Channel[] }>(`/api/guilds/${encodeURIComponent(activeGuildId)}/channels`),
      api<{ categories: CommunityCategory[] }>(`/api/guilds/${encodeURIComponent(activeGuildId)}/categories`),
      api<{ members: CommunityMember[]; canManageMembers: boolean }>(`/api/guilds/${encodeURIComponent(activeGuildId)}/members`),
      api<{ preferences: Record<string, string | boolean | number | string[] | null> }>(`/api/guilds/${encodeURIComponent(activeGuildId)}/preferences`),
    ])
      .then(([{ channels: nextChannels }, { categories: nextCategories }, memberResult, preferencesResult]) => {
        if (cancelled) return;
        const nextChannelId = nextChannels[0]?.id ?? '';
        const cachedMessages = messageCacheRef.current.get(`channel:${nextChannelId}`) ?? [];
        messagesRef.current = cachedMessages;
        setMessages(cachedMessages);
        setChannels(nextChannels);
        setCategories(nextCategories);
        setMembers(memberResult.members);
        setCanManageMembers(memberResult.canManageMembers);
        setCommunityPreferences(preferencesResult.preferences);
        setFavoriteChannels(Array.isArray(preferencesResult.preferences.favoriteChannelIds) ? preferencesResult.preferences.favoriteChannelIds : []);
        setActiveChannelId(nextChannelId);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [account, activeGuildId]);

  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get('invite');
    if (!invite) return;
    startTransition(() => {
      setInviteCode(invite);
      setServerDialogView('join');
      setServerDialogOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!account || !activeGuildId) return;
    let cancelled = false;
    api<{
      preferences: Record<string, string | boolean | number | null>;
      profile: { nickname: string; bio: string };
    }>(`/api/guilds/${encodeURIComponent(activeGuildId)}/preferences`)
      .then((result) => {
        if (!cancelled) {
          setCommunityPreferences(result.preferences);
          setCommunityProfile(result.profile);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      });
    return () => { cancelled = true; };
  }, [account, activeGuildId]);

  useEffect(() => {
    if (!communityMenuOpen) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !communityMenuRef.current?.contains(event.target)) {
        setCommunityMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setCommunityMenuOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [communityMenuOpen]);

  useEffect(() => {
    if (!settingsOpen || !account) return;
    let cancelled = false;
    api<{ profile: AppProfile; preferences: AppPreferences }>('/api/settings')
      .then(({ profile, preferences: nextPreferences }) => {
        if (cancelled) return;
        setProfileSettings(profile);
        setPreferences(nextPreferences);
        setPersistedProfile(profile);
        setPersistedPreferences(nextPreferences);
        setSettingsDirty(false);
        setSettingsUsername(account.username);
        setSettingsStatus(account.status);
        setTheme(nextPreferences.appearance.theme);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setSettingsError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => { cancelled = true; };
  }, [account, settingsOpen, setTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.highContrast = String(preferences?.accessibility.highContrast ?? false);
    root.dataset.reducedMotion = String(preferences?.accessibility.reducedMotion ?? false);
    root.dataset.underlineLinks = String(preferences?.accessibility.underlineLinks ?? false);
    root.style.setProperty('--cordly-saturation', `${preferences?.appearance.saturation ?? 100}%`);
    return () => {
      delete root.dataset.highContrast;
      delete root.dataset.reducedMotion;
      delete root.dataset.underlineLinks;
      root.style.removeProperty('--cordly-saturation');
    };
  }, [preferences]);

  useEffect(() => {
    if (!settingsOpen || settingsPage !== 'account') return;
    let cancelled = false;
    api<{ sessions: ActiveSession[] }>('/api/auth/sessions')
      .then(({ sessions }) => { if (!cancelled) setActiveSessions(sessions); })
      .catch((loadError: unknown) => { if (!cancelled) setSettingsError(getErrorMessage(loadError)); });
    return () => { cancelled = true; };
  }, [settingsOpen, settingsPage]);

  useEffect(() => {
    if (!account || (workspace === 'servers' && !activeChannelId) || (workspace === 'friends' && !activeDmId)) {
      return;
    }

    let cancelled = false;
    const messagesUrl = workspace === 'friends' && activeDmId
      ? `/api/dms/${encodeURIComponent(activeDmId)}/messages`
      : `/api/channels/${encodeURIComponent(activeChannelId)}/messages`;
    api<{ messages: ChatMessage[] }>(messagesUrl)
      .then(({ messages: nextMessages }) => {
        if (!cancelled) {
          setMessages((current) => reconcileRecentChatMessages(current, nextMessages));
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getErrorMessage(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [account, activeChannelId, activeDmId, workspace]);

  useEffect(() => {
    if (!account || workspace !== 'servers' || !activeChannelId) return;
    if (socketConnected) return;
    let cancelled = false;
    async function refreshTyping() {
      try {
        const result = await api<{ users: string[] }>(`/api/channels/${encodeURIComponent(activeChannelId)}/typing`);
        if (!cancelled) {
          setTypingUsers(result.users);
          setTypingRoomKey(`channel:${activeChannelId}`);
        }
      } catch (typingError) {
        if (!cancelled) setError(getErrorMessage(typingError));
      }
    }
    void refreshTyping();
    const timer = window.setInterval(() => void refreshTyping(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [account, activeChannelId, socketConnected, workspace]);

  useEffect(() => {
    if (!account || !activeGuildId) return;
    const timer = window.setInterval(() => {
      api<{ members: CommunityMember[]; canManageMembers: boolean }>(
        `/api/guilds/${encodeURIComponent(activeGuildId)}/members`,
      ).then((result) => {
        setMembers(result.members);
        setCanManageMembers(result.canManageMembers);
      }).catch((presenceError: unknown) => setError(getErrorMessage(presenceError)));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [account, activeGuildId]);

  useEffect(() => {
    if (!account || (workspace === 'servers' && !activeChannelId) || (workspace === 'friends' && !activeDmId)) return;
    let cancelled = false;
    let polling = false;
    async function pollMessages() {
      if (cancelled || polling || document.visibilityState !== 'visible') return;
      polling = true;
      try {
        const cursor = messagesRef.current.at(-1)?.id;
      const query = cursor ? `?after=${encodeURIComponent(cursor)}` : '';
      const messagesUrl = workspace === 'friends' && activeDmId
        ? `/api/dms/${encodeURIComponent(activeDmId)}/messages${query}`
        : `/api/channels/${encodeURIComponent(activeChannelId)}/messages${query}`;
        const { messages: incoming } = await api<{ messages: ChatMessage[] }>(messagesUrl);
          if (!cancelled && incoming.length) {
          setMessages((current) => {
            const next = mergeChatMessages(current, incoming);
            messagesRef.current = next;
            return next;
          });
          const currentDm = activeDmRef.current;
          if (workspace === 'friends' && currentDm?.id === activeDmId) {
            const latest = incoming.at(-1);
            if (latest) {
              setActiveDm((current) => current?.id === activeDmId ? {
                ...current,
                updatedAt: latest.createdAt,
                lastMessage: { id: latest.id, content: latest.content, createdAt: latest.createdAt, authorId: latest.author.id },
              } : current);
              setDirectConversations((current) => {
                const conversation = current.find((item) => item.id === activeDmId);
                if (!conversation) return current;
                const updated = {
                  ...conversation,
                  updatedAt: latest.createdAt,
                  lastMessage: { id: latest.id, content: latest.content, createdAt: latest.createdAt, authorId: latest.author.id },
                };
                return [updated, ...current.filter((item) => item.id !== updated.id)];
              });
            }
          }
        }
      } catch (pollError) {
        if (!cancelled) setError(getErrorMessage(pollError));
      } finally {
        polling = false;
      }
    }
    const timer = window.setInterval(() => void pollMessages(), socketConnected ? 2500 : 1800);
    function refreshOnReturn() {
      if (document.visibilityState === 'visible') void pollMessages();
    }
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [account, activeChannelId, activeDmId, socketConnected, workspace]);

  useEffect(() => {
    if (!account) return;
    const currentUserId = account.id;
    let cancelled = false;
    let refreshing = false;
    async function refreshConversations() {
      if (cancelled || refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        const result = await api<{ conversations: DirectConversation[] }>('/api/dms');
        if (!cancelled) {
          if (dmActivityInitializedRef.current) {
            const previousActivity = dmActivityRef.current;
            const newlyReceived = result.conversations.filter((conversation) => {
              const latest = conversation.lastMessage;
              return Boolean(
                latest
                && latest.authorId !== currentUserId
                && previousActivity.get(conversation.id) !== latest.id
                && !(workspace === 'friends' && document.visibilityState === 'visible' && activeDmRef.current?.id === conversation.id),
              );
            });
            const newestIncoming = newlyReceived[0];
            if (newestIncoming) notifyIncomingDmRef.current(newestIncoming);
          }
          dmActivityRef.current = new Map(result.conversations.map((conversation) => [conversation.id, conversation.lastMessage?.id ?? '']));
          dmActivityInitializedRef.current = true;
          setDirectConversations(result.conversations);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError));
      } finally {
        refreshing = false;
      }
    }
    void refreshConversations();
    const timer = window.setInterval(() => void refreshConversations(), socketConnected ? 5000 : 2500);
    function refreshOnReturn() {
      if (document.visibilityState === 'visible') void refreshConversations();
    }
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [account, socketConnected, workspace]);

  useEffect(() => {
    if (!serverDialogOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setServerDialogOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [serverDialogOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') closeSettings();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        settingsSearchRef.current?.focus();
      }
      if (event.key === '/' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        settingsSearchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [settingsOpen]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAuthError('');
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        authMode === 'login'
          ? { identifier: authForm.identifier, password: authForm.password, ...(authTotpCode ? { code: authTotpCode } : {}) }
          : {
              email: authForm.email,
              username: authForm.username,
              password: authForm.password,
              dateOfBirth: authForm.dateOfBirth,
            };
      const result = await api<{ user: Account }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAccount(result.user);
      setAuthCodeRequired(false);
      setAuthTotpCode('');
      await Promise.all([loadGuilds(), loadFriends(), loadDirectConversations()]);
      notifySuccess(authMode === 'login' ? 'Welcome back' : 'Account created');
    } catch (submitError) {
      const message = getErrorMessage(submitError);
      if (message.toLowerCase().includes('authenticator code')) setAuthCodeRequired(true);
      setAuthError(message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setError('');
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setAccount(null);
      setGuilds([]);
      setChannels([]);
      setMessages([]);
      messageCacheRef.current.clear();
      dmActivityRef.current.clear();
      dmActivityInitializedRef.current = false;
      setUnreadDmIds(new Set());
      setFriends([]);
      setDirectConversations([]);
      setActiveDm(null);
    } catch (logoutError) {
      setError(getErrorMessage(logoutError));
    }
  }

  async function changeAccountStatus(status: Account['status']) {
    try {
      const result = await api<{ user: Account }>('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setAccount(result.user);
      notifySuccess(`Status changed to ${status === 'dnd' ? 'Do not disturb' : status}`);
    } catch (statusError) {
      setError(getErrorMessage(statusError));
    }
  }

  async function copyAccountId() {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.id);
      notifySuccess('User ID copied');
    } catch (clipboardError) {
      setError(getErrorMessage(clipboardError));
    }
  }

  async function refreshFriends() {
    try {
      await Promise.all([loadFriends(), loadDirectConversations()]);
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    }
  }

  async function createServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ guild: Guild; channel: Channel }>('/api/guilds', {
        method: 'POST',
        body: JSON.stringify({ name: guildName }),
      });
      setGuilds((current) => [...current, result.guild]);
      setGuildName('');
      setWorkspace('servers');
      setServerDialogOpen(false);
      setServerDialogView('choose');
      setChannels([]);
      setMessages([]);
      setActiveChannelId('');
      setActiveGuildId(result.guild.id);
      notifySuccess('Community created');
    } catch (createError) {
      setError(getErrorMessage(createError));
    }
  }

  async function joinServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      const result = await api<{ guild: Guild; channel: Channel | null }>('/api/guilds/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      });
      setGuilds((current) =>
        current.some((guild) => guild.id === result.guild.id)
          ? current
          : [...current, result.guild],
      );
      setInviteCode('');
      setWorkspace('servers');
      setServerDialogOpen(false);
      setServerDialogView('choose');
      setChannels([]);
      setMessages([]);
      setActiveChannelId('');
      setActiveGuildId(result.guild.id);
      notifySuccess('Joined community');
    } catch (joinError) {
      setError(getErrorMessage(joinError));
    }
  }

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeGuild) return;
    setError('');
    try {
      const result = await api<{ channel: Channel }>(
        `/api/guilds/${encodeURIComponent(activeGuild.id)}/channels`,
        { method: 'POST', body: JSON.stringify({ name: channelName, categoryId: selectedCategoryId || null }) },
      );
      setChannels((current) => [...current, result.channel]);
      const cachedMessages = messageCacheRef.current.get(`channel:${result.channel.id}`) ?? [];
      messagesRef.current = cachedMessages;
      setMessages(cachedMessages);
      setActiveChannelId(result.channel.id);
      setChannelName('');
      setSelectedCategoryId('');
      setCommunityModal(null);
      notifySuccess('Channel created');
    } catch (createError) {
      setError(getErrorMessage(createError));
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!activeGuild) return;
      try {
        const { category } = await api<{ category: CommunityCategory }>(
          `/api/guilds/${encodeURIComponent(activeGuild.id)}/categories`,
          { method: 'POST', body: JSON.stringify({ name: categoryName }) },
        );
        setCategories((current) => [...current, category]);
        setCategoryName('');
        setCommunityModal(null);
        notifySuccess('Category created');
      } catch (createError) {
        setError(getErrorMessage(createError));
      }
    }

  async function createCommunityInvite() {
      if (!activeGuild) return;
      try {
        const result = await api<{ invite: { code: string } }>(
          `/api/guilds/${encodeURIComponent(activeGuild.id)}/invites`,
          {
            method: 'POST',
            body: JSON.stringify({ expiryHours: inviteExpiry, maxUses: inviteMaxUses }),
          },
        );
        setCreatedInvite(result.invite.code);
        notifySuccess('Invite created');
      } catch (inviteError) {
        setError(getErrorMessage(inviteError));
      }
    }

  async function saveCommunitySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeGuild) return;
    setCommunitySettingsSaving(true);
    setError('');
    try {
      const result = await api<{ community: Guild }>(`/api/guilds/${encodeURIComponent(activeGuild.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: communityNameDraft, detachedBanner: detachedBannerDraft }),
      });
      setGuilds((current) => current.map((guild) => guild.id === result.community.id ? { ...guild, ...result.community } : guild));
      notifySuccess('Community settings saved');
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setCommunitySettingsSaving(false);
    }
    }

  async function saveCommunityPreferences(patch: Record<string, string | boolean | number | string[]>) {
      if (!activeGuild) return;
      try {
        const result = await api<{
          preferences: Record<string, string | boolean | number | string[] | null>;
          profile: { nickname: string; bio: string };
        }>(`/api/guilds/${encodeURIComponent(activeGuild.id)}/preferences`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        setCommunityPreferences(result.preferences);
        setCommunityProfile(result.profile);
        notifySuccess('Community preferences updated');
      } catch (saveError) {
        setError(getErrorMessage(saveError));
      }
    }

  async function loadCommunityPreferences() {
      if (!activeGuild) return;
      try {
        const result = await api<{
          preferences: Record<string, string | boolean | number | string[] | null>;
          profile: { nickname: string; bio: string };
        }>(`/api/guilds/${encodeURIComponent(activeGuild.id)}/preferences`);
        setCommunityPreferences(result.preferences);
        setCommunityProfile(result.profile);
      } catch (loadError) {
        setError(getErrorMessage(loadError));
      }
    }

  async function leaveCommunity() {
      if (!activeGuild) return;
      try {
        await api(`/api/guilds/${encodeURIComponent(activeGuild.id)}/leave`, { method: 'POST' });
        const remaining = guilds.filter((guild) => guild.id !== activeGuild.id);
        setGuilds(remaining);
        setActiveGuildId(remaining[0]?.id ?? '');
        setChannels([]);
        setCategories([]);
        setMembers([]);
        setMessages([]);
        setActiveChannelId('');
        setWorkspace('friends');
        setCommunityModal(null);
        notifySuccess('You left the community');
      } catch (leaveError) {
        setError(getErrorMessage(leaveError));
      }
    }

  async function copyCreatedInvite() {
      if (!createdInvite) return;
      try {
        const url = new URL('/', window.location.origin);
        url.searchParams.set('invite', createdInvite);
        await navigator.clipboard.writeText(url.toString());
        notifySuccess('Invite link copied');
      } catch (copyError) {
        setError(getErrorMessage(copyError));
      }
    }
  async function uploadFiles(files: FileList | File[]) {
    const attachmentEndpoint = workspace === 'friends' && activeDm
      ? `/api/dms/${encodeURIComponent(activeDm.id)}/attachments`
      : activeChannel
        ? `/api/channels/${encodeURIComponent(activeChannel.id)}/attachments`
        : null;
    if (!attachmentEndpoint || !files.length) return;
    const availableSlots = 10 - messageAttachments.length;
    if (files.length > availableSlots) {
      setError('You can attach up to 10 files to one message.');
      return;
    }
    setAttachmentBusy(true);
    try {
      const uploaded = await Promise.all(Array.from(files).map(async (file) => {
        const form = new FormData();
        form.set('file', file);
        const result = await api<{ attachment: MessageAttachment }>(
          attachmentEndpoint,
          { method: 'POST', body: form },
        );
        return result.attachment;
      }));
      setMessageAttachments((current) => [...current, ...uploaded]);
      setError('');
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function actOnMessage(message: ChatMessage, action: 'react' | 'pin' | 'delete' | 'edit' | 'report', emoji?: '👍' | '❤️' | '😂' | '🎉' | '👀') {
    if (!activeChannel) return;
    if (action === 'edit') {
      setEditingMessage(message);
      setReplyTarget(null);
      setMessageDraft(message.content);
      return;
    }
    if (action === 'delete' && !window.confirm('Delete this message? This cannot be undone.')) return;
    try {
      const result = await api<{ success: boolean; deleted?: boolean; id?: string; content?: string; pinned?: boolean; editedAt?: string | null }>(
        `/api/channels/${encodeURIComponent(activeChannel.id)}/messages?messageId=${encodeURIComponent(message.id)}`,
        { method: 'PATCH', body: JSON.stringify({ action, ...(emoji ? { emoji } : {}) }) },
      );
      if (result.deleted) {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      } else {
        setMessages((current) => current.map((item) => item.id === message.id ? {
          ...item,
          content: result.content ?? item.content,
          pinned: result.pinned ?? item.pinned,
          editedAt: result.editedAt ?? item.editedAt,
          reactions: action === 'react' && emoji ? (() => {
            const existing = item.reactions.find((reaction) => reaction.emoji === emoji);
            if (!existing) return [...item.reactions, { emoji, count: 1, reacted: true }];
            return existing.reacted
              ? item.reactions.filter((reaction) => reaction.emoji !== emoji)
              : item.reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.count + 1, reacted: true } : reaction);
          })() : item.reactions,
        } : item));
      }
      if (action === 'report') notifySuccess('Message reported');
      else if (action === 'pin') notifySuccess(message.pinned ? 'Message unpinned' : 'Message pinned');
      else if (action === 'delete') notifySuccess('Message deleted');
      else setError('');
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attachmentBusy) return;
    if (workspace === 'friends' && activeDm) {
      if (!messageDraft.trim() && messageAttachments.length === 0) return;
      const content = messageDraft;
      try {
        const result = await api<{ message: ChatMessage }>(
          `/api/dms/${encodeURIComponent(activeDm.id)}/messages`,
          { method: 'POST', body: JSON.stringify({
            content,
            attachmentIds: messageAttachments.map((attachment) => attachment.id),
          }) },
        );
        setMessages((current) => current.some((message) => message.id === result.message.id) ? current : [...current, result.message]);
        const updatedAt = result.message.createdAt;
        const updated = {
          ...activeDm,
          updatedAt,
          lastMessage: {
            id: result.message.id,
            content: result.message.content,
            createdAt: updatedAt,
            authorId: result.message.author.id,
          },
        };
        setActiveDm(updated);
        setDirectConversations((current) => [updated, ...current.filter((conversation) => conversation.id !== updated.id)]);
        setMessageAttachments([]);
        setMessageDraft('');
        try { localStorage.removeItem(`cordly-draft:${account?.id}:dm:${activeDm.id}`); }
        catch (storageError) { setError(getErrorMessage(storageError)); }
        setError('');
      } catch (sendError) {
        setError(getErrorMessage(sendError));
      }
      return;
    }
    if (!activeChannel || (!messageDraft.trim() && messageAttachments.length === 0)) return;
    const content = messageDraft;
    try {
      if (editingMessage) {
        const result = await api<{ id: string; content: string; editedAt: string }>(
          `/api/channels/${encodeURIComponent(activeChannel.id)}/messages?messageId=${encodeURIComponent(editingMessage.id)}`,
          { method: 'PATCH', body: JSON.stringify({ action: 'edit', content }) },
        );
        setMessages((current) => current.map((message) => message.id === result.id ? { ...message, content: result.content, editedAt: result.editedAt } : message));
        setEditingMessage(null);
        notifySuccess('Message updated');
      } else {
        const result = await api<{ message: ChatMessage }>(
          `/api/channels/${encodeURIComponent(activeChannel.id)}/messages`,
          { method: 'POST', body: JSON.stringify({
            content,
            attachmentIds: messageAttachments.map((attachment) => attachment.id),
            ...(replyTarget ? { replyToId: replyTarget.id } : {}),
          }) },
        );
        setMessages((current) => current.some((message) => message.id === result.message.id) ? current : [...current, result.message]);
        setMessageAttachments([]);
        setReplyTarget(null);
      }
      setMessageDraft('');
      if (activeChannel) {
        try { localStorage.removeItem(`cordly-draft:${account?.id}:${activeChannel.id}`); }
        catch (storageError) { setError(getErrorMessage(storageError)); }
      }
      setError('');
    } catch (sendError) {
      setError(getErrorMessage(sendError));
    }
  }

  function selectChannel(channelId: string) {
      if (activeChannelId === channelId) return;
      if (activeDm && account) {
        try { localStorage.setItem(`cordly-draft:${account.id}:dm:${activeDm.id}`, messageDraft); }
        catch (storageError) { setError(getErrorMessage(storageError)); }
      }
      if (activeChannelId && account) {
        try { localStorage.setItem(`cordly-draft:${account.id}:${activeChannelId}`, messageDraft); }
        catch (storageError) { setError(getErrorMessage(storageError)); }
      }
      if (account) {
        try { setMessageDraft(localStorage.getItem(`cordly-draft:${account.id}:${channelId}`) ?? ''); }
        catch (storageError) { setError(getErrorMessage(storageError)); }
      }
      setReplyTarget(null);
      setEditingMessage(null);
      setMessageAttachments([]);
      const cachedMessages = messageCacheRef.current.get(`channel:${channelId}`) ?? [];
      messagesRef.current = cachedMessages;
      setMessages(cachedMessages);
      setActiveDm(null);
      setActiveChannelId(channelId);
    }

  function selectDirectConversation(conversation: DirectConversation) {
    setUnreadDmIds((current) => {
      if (!current.has(conversation.id)) return current;
      const next = new Set(current);
      next.delete(conversation.id);
      return next;
    });
    if (activeDm?.id === conversation.id) return;
    if (activeDm && account) {
      try { localStorage.setItem(`cordly-draft:${account.id}:dm:${activeDm.id}`, messageDraft); }
      catch (storageError) { setError(getErrorMessage(storageError)); }
    }
    setWorkspace('friends');
    setActiveDm(conversation);
    const cachedMessages = messageCacheRef.current.get(`dm:${conversation.id}`) ?? [];
    messagesRef.current = cachedMessages;
    setMessages(cachedMessages);
    setReplyTarget(null);
    setEditingMessage(null);
    setMessageAttachments([]);
    setDmSearch('');
    setDmSearchOpen(false);
    if (account) {
      try { setMessageDraft(localStorage.getItem(`cordly-draft:${account.id}:dm:${conversation.id}`) ?? ''); }
      catch (storageError) { setError(getErrorMessage(storageError)); }
    }
  }

  async function openDirectMessage(friend: FriendRelation['user']) {
    try {
      const result = await api<{ id: string }>('/api/dms', {
        method: 'POST',
        body: JSON.stringify({ recipientId: friend.id }),
      });
      const conversation = directConversations.find((item) => item.id === result.id) ?? {
        id: result.id,
        updatedAt: new Date().toISOString(),
        lastMessage: null,
        user: friend,
      };
      setDirectConversations((current) => current.some((item) => item.id === conversation.id)
        ? current
        : [conversation, ...current]);
      selectDirectConversation(conversation);
    } catch (openError) {
      setError(getErrorMessage(openError));
    }
  }

  function sendTypingSignal(active: boolean) {
    const room: RealtimeRoom | null = activeDm
    ? { type: 'dm', id: activeDm.id }
    : activeChannel
      ? { type: 'channel', id: activeChannel.id }
      : null;
    if (!room) return;
    const socket = socketRef.current;
    if (socketConnectedRef.current && socket) {
    socket.emit('typing:set', { ...room, active });
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    if (active) {
      typingStopTimerRef.current = window.setTimeout(() => {
        socket.emit('typing:set', { ...room, active: false });
        typingStopTimerRef.current = null;
      }, 4000);
    }
    return;
    }
    if (room.type === 'channel' && active) {
    void api(`/api/channels/${encodeURIComponent(room.id)}/typing`, { method: 'POST' })
      .catch((typingError: unknown) => setError(getErrorMessage(typingError)));
    }
  }

  async function sendFriendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/friends', {
        method: 'POST',
        body: JSON.stringify({ identifier: friendIdentifier }),
      });
      setFriendIdentifier('');
      await loadFriends();
      notifySuccess('Friend request sent');
    } catch (friendError) {
      setError(getErrorMessage(friendError));
    }
  }

  async function answerFriendRequest(friendshipId: string, action: 'accept' | 'decline' | 'block') {
    try {
      await api(`/api/friends/${encodeURIComponent(friendshipId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      await loadFriends();
      if (action === 'accept') await loadDirectConversations();
      notifySuccess(action === 'accept' ? 'Friend request accepted' : action === 'decline' ? 'Friend request denied' : 'User blocked');
    } catch (friendError) {
      setError(getErrorMessage(friendError));
    }
  }

  async function openUserProfile(userId: string, expanded = false) {
    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    setMemberProfile(null);
    setMemberProfileLoading(true);
    setMemberProfileFull(expanded);
    setMemberProfileTab('overview');
    try {
      const communityQuery = workspace === 'servers' && activeGuild ? `?communityId=${encodeURIComponent(activeGuild.id)}` : '';
      const result = await api<{ profile: UserProfileView }>(`/api/users/${encodeURIComponent(userId)}/profile${communityQuery}`);
      if (profileRequestRef.current === requestId) setMemberProfile(result.profile);
    } catch (profileError) {
      if (profileRequestRef.current === requestId) setError(getErrorMessage(profileError));
    } finally {
      if (profileRequestRef.current === requestId) setMemberProfileLoading(false);
    }
  }

  async function sendProfileFriendRequest() {
    if (!memberProfile) return;
    const requestId = profileRequestRef.current;
    try {
      await api('/api/friends', {
        method: 'POST',
        body: JSON.stringify({ identifier: `${memberProfile.username}#${memberProfile.tag}` }),
      });
      const result = await api<{ profile: UserProfileView }>(
        `/api/users/${encodeURIComponent(memberProfile.id)}/profile${workspace === 'servers' && activeGuild ? `?communityId=${encodeURIComponent(activeGuild.id)}` : ''}`,
      );
      if (profileRequestRef.current === requestId) {
        setMemberProfile(result.profile);
        await loadFriends();
        notifySuccess('Friend request sent');
      }
    } catch (requestError) {
      if (profileRequestRef.current === requestId) setError(getErrorMessage(requestError));
    }
  }

  function openContextMenu(event: MouseEvent, menu: ContextMenuInput) {
    event.preventDefault();
    const width = 248;
    const height = menu.kind === 'message' ? 440 : 280;
    setContextMenu({
      ...menu,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    });
  }

  async function addFriendFromContext(user: { username: string; tag: string }) {
    try {
      await api('/api/friends', {
        method: 'POST',
        body: JSON.stringify({ identifier: `${user.username}#${user.tag}` }),
      });
      await loadFriends();
      notifySuccess('Friend request sent');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }

  function copyContextValue(value: string, successMessage: string) {
    void navigator.clipboard.writeText(value)
      .then(() => notifySuccess(successMessage))
      .catch((copyError: unknown) => setError(getErrorMessage(copyError)));
  }

  function openSettings() {
    if (!account) return;
    setSettingsLoading(true);
    setSettingsUsername(account.username);
    setSettingsTag(account.tag);
    setSettingsStatus(account.status);
    setSettingsError('');
    const requestedPage = new URLSearchParams(window.location.search).get('settings');
    if (requestedPage && SETTINGS_REGISTRY.some((page) => page.id === requestedPage)) {
      setSettingsPage(requestedPage as SettingsPageId);
    } else {
      setSettingsPage('profile');
    }
    setSettingsDirty(false);
    setSettingsOpen(true);
  }

  function openSettingsPage(page: SettingsPageId) {
    setSettingsPage(page);
    const url = new URL(window.location.href);
    url.searchParams.set('settings', page);
    window.history.replaceState(null, '', url.toString());
  }

  function closeSettings() {
    setSettingsOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('settings');
    window.history.replaceState(null, '', url.toString());
  }

  function resetSettingsDraft() {
    if (persistedProfile) setProfileSettings(persistedProfile);
    if (persistedPreferences) setPreferences(persistedPreferences);
    setSettingsUsername(account?.username ?? '');
    setSettingsTag(account?.tag ?? '');
    setSettingsStatus(account?.status ?? 'offline');
    setSettingsDirty(false);
    setSettingsError('');
  }

  function updateProfile<K extends keyof AppProfile>(key: K, value: AppProfile[K]) {
    setProfileSettings((current) => current ? { ...current, [key]: value } : current);
    setSettingsDirty(true);
  }

  function updatePreference<K extends 'appearance' | 'notifications' | 'privacy' | 'chat' | 'accessibility'>(
    section: K,
    key: keyof AppPreferences[K],
    value: AppPreferences[K][keyof AppPreferences[K]],
  ) {
    setPreferences((current) => current ? {
      ...current,
      [section]: { ...current[section], [key]: value },
    } : current);
    setSettingsDirty(true);
    if (section === 'appearance' && key === 'theme') setTheme(value as AppPreferences['appearance']['theme']);
  }

  function updateRootPreference(key: 'language' | 'developerMode', value: string | boolean) {
    setPreferences((current) => current ? { ...current, [key]: value } : current);
    setSettingsDirty(true);
  }

  async function changePassword() {
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: passwordFields.current, newPassword: passwordFields.next }),
      });
      setPasswordFields({ current: '', next: '' });
      setSettingsError('');
      notifySuccess('Password changed');
    } catch (changeError) {
      setSettingsError(getErrorMessage(changeError));
    }
  }

  async function startTotpSetup() {
    try {
      const result = await api<{ qrCode: string; secret: string }>('/api/auth/totp', {
        method: 'POST',
        body: JSON.stringify({ action: 'setup', currentPassword: passwordFields.current }),
      });
      setTotpSetup(result);
      setTotpCode('');
      setSettingsError('');
    } catch (setupError) {
      setSettingsError(getErrorMessage(setupError));
    }
  }

  async function updateTotp(action: 'enable' | 'disable') {
    try {
      const result = await api<{ enabled: boolean; backupCodes?: string[] }>('/api/auth/totp', {
        method: 'POST',
        body: JSON.stringify({ action, code: totpCode }),
      });
      setAccount((current) => current ? { ...current, twoFactorEnabled: result.enabled } : current);
      setBackupCodes(result.backupCodes ?? []);
      setTotpSetup(null);
      setTotpCode('');
      setSettingsError('');
      notifySuccess(action === 'enable' ? 'Two-factor authentication enabled' : 'Two-factor authentication disabled');
    } catch (totpError) {
      setSettingsError(getErrorMessage(totpError));
    }
  }

  async function revokeSession(sessionId: string) {
    try {
      await api(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      setActiveSessions((current) => current.filter((session) => session.id !== sessionId));
      if (activeSessions.some((session) => session.id === sessionId && session.current)) {
        await api('/api/auth/logout', { method: 'POST' });
        setAccount(null);
        setGuilds([]);
        setChannels([]);
        setMessages([]);
        messageCacheRef.current.clear();
        dmActivityRef.current.clear();
        dmActivityInitializedRef.current = false;
        setUnreadDmIds(new Set());
        setFriends([]);
      }
    } catch (revokeError) {
      setSettingsError(getErrorMessage(revokeError));
    }
  }

  async function exportAccountData() {
    try {
      const response = await fetch('/api/auth/export', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const result: unknown = await response.json();
        throw new Error(typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string' ? result.error : 'Account data could not be exported.');
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'cordly-account-data.json';
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (exportError) {
      setSettingsError(getErrorMessage(exportError));
    }
  }

  async function deactivateAccount() {
    if (!deactivatePassword) {
      setSettingsError('Enter your password to confirm account deactivation.');
      return;
    }
    try {
      await api('/api/auth/deactivate', { method: 'POST', body: JSON.stringify({ password: deactivatePassword }) });
      await api('/api/auth/logout', { method: 'POST' });
      setAccount(null);
      setSettingsOpen(false);
    } catch (deactivateError) {
      setSettingsError(getErrorMessage(deactivateError));
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || !profileSettings || !preferences) return;
    setSettingsSaving(true);
    setSettingsError('');
    try {
      const result = await api<{ user: Account }>('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ username: settingsUsername, tag: settingsTag, status: settingsStatus }),
      });
      setAccount(result.user);
      const settingsResult = await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ profile: profileSettings, preferences }),
      });
      void settingsResult;
      setPersistedProfile(profileSettings);
      setPersistedPreferences(preferences);
      setSettingsDirty(false);
      setSettingsError('');
      notifySuccess('Profile updated');
    } catch (saveError) {
      setSettingsError(getErrorMessage(saveError));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveAvatar(remove = false) {
    if (!account) return;
    const selectedFile = avatarFile;
    if (!remove && !selectedFile) {
      setSettingsError('Choose a profile picture first.');
      return;
    }

    setSettingsSaving(true);
    setSettingsError('');
    try {
      if (remove) {
        await api('/api/auth/avatar', { method: 'DELETE' });
        setAccount((current) => (current ? { ...current, avatarUrl: null } : current));
        notifySuccess('Profile picture removed');
      } else {
        if (!selectedFile) throw new Error('Choose a profile picture first.');
        const form = new FormData();
        form.set('avatar', selectedFile);
        const result = await api<{ avatarUrl: string }>('/api/auth/avatar', {
          method: 'POST',
          body: form,
        });
        setAccount((current) => (current ? { ...current, avatarUrl: result.avatarUrl } : current));
        setAvatarFile(null);
        notifySuccess('Profile picture updated');
      }
    } catch (saveError) {
      setSettingsError(getErrorMessage(saveError));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function saveBanner(remove = false) {
    if (!account) return;
    setSettingsSaving(true);
    setSettingsError('');
    try {
      if (remove) {
        await api('/api/auth/banner', { method: 'DELETE' });
        setAccount((current) => current ? { ...current, bannerUrl: null } : current);
        notifySuccess('Profile banner removed');
      } else {
        if (!bannerFile) throw new Error('Choose a banner image first.');
        const form = new FormData();
        form.set('banner', bannerFile);
        const result = await api<{ bannerUrl: string }>('/api/auth/banner', { method: 'POST', body: form });
        setAccount((current) => current ? { ...current, bannerUrl: result.bannerUrl } : current);
        setBannerFile(null);
        notifySuccess('Profile banner updated');
      }
    } catch (saveError) {
      setSettingsError(getErrorMessage(saveError));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function copyInvite() {
    if (!activeGuild) return;
    try {
      await navigator.clipboard.writeText(activeGuild.inviteCode);
      notifySuccess('Invite code copied');
    } catch {
      setError(`Invite code: ${activeGuild.inviteCode}`);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b0d12] text-sm text-slate-400">
        Loading Cordly…
      </main>
    );
  }

  if (!account) {
    return (
      <main className="cordly-page-enter relative flex min-h-dvh overflow-x-hidden bg-[#0b0d12] text-white">
        <aside className="relative hidden w-[44%] min-w-[420px] flex-col overflow-hidden border-r border-white/5 bg-[#171523] px-12 py-10 lg:flex xl:px-16">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(124,92,230,0.25),transparent_55%),radial-gradient(ellipse_at_90%_90%,rgba(79,70,229,0.15),transparent_45%)]" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -left-40 h-[34rem] w-[34rem] rounded-full border border-white/5" />
          <div className="relative flex items-center gap-3 text-lg font-bold tracking-tight">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#5865f2] text-xl shadow-lg shadow-indigo-950/40">C</span>
            Cordly
          </div>
          <div className="relative my-auto max-w-lg py-16">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-200/80">A place to belong</p>
            <h2 className="max-w-md text-4xl font-bold leading-[1.12] tracking-tight xl:text-5xl">Stay close to your communities.</h2>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-300">Find your people, keep conversations going, and make a space that feels like yours.</p>
            <div className="mt-10 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-400/15 text-indigo-200"><Users size={18} /></span>
                <p className="text-sm font-semibold">Your communities</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Shared spaces for the things you care about.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm">
                <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-400/15 text-violet-200"><MessageSquare size={18} /></span>
                <p className="text-sm font-semibold">One-to-one chats</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">Keep up with friends, all in one place.</p>
              </div>
            </div>
          </div>
          <p className="relative text-xs text-slate-500">Your conversations, your space.</p>
        </aside>
        <section className="relative flex min-h-dvh min-w-0 flex-1 flex-col px-5 sm:px-10 lg:px-14">
          <header className="flex items-center justify-between py-6 lg:justify-end">
            <div className="flex items-center gap-2 text-sm font-semibold lg:hidden"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#5865f2]">C</span>Cordly</div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{authMode === 'login' ? 'New to Cordly?' : 'Already have an account?'}</span>
              <button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); setError(''); }} className="rounded-xl border border-white/10 px-3.5 py-2 font-semibold text-slate-200 hover:border-indigo-300/40 hover:bg-white/5 hover:text-white">
                {authMode === 'login' ? 'Create account' : 'Sign in'}
              </button>
            </div>
          </header>
          <div className="flex flex-1 items-center justify-center py-8">
            <div key={authMode} className="cordly-auth-enter w-full max-w-[390px]">
              <div className="mb-8">
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#27283a] text-indigo-200"><MessageSquare size={21} /></div>
                <h1 className="text-3xl font-bold tracking-tight">{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
                <p className="mt-2 text-sm text-slate-400">{authMode === 'login' ? 'Sign in to pick up right where you left off.' : 'Join Cordly and start building your space.'}</p>
              </div>
              <form onSubmit={submitAuth} className="space-y-4">
                {authMode === 'register' ? (
                  <>
                    <label className="block text-sm font-medium text-slate-300">Email
                      <input required type="email" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} className={`${inputClass} border-white/10 bg-[#20212a] py-3`} placeholder="you@example.com" />
                    </label>
                    <label className="block text-sm font-medium text-slate-300">Username
                      <input required minLength={2} maxLength={32} autoComplete="username" value={authForm.username} onChange={(event) => setAuthForm({ ...authForm, username: event.target.value })} className={`${inputClass} border-white/10 bg-[#20212a] py-3`} placeholder="Choose a username" />
                    </label>
                    <label className="block text-sm font-medium text-slate-300">Date of birth
                      <input required type="date" value={authForm.dateOfBirth} onChange={(event) => setAuthForm({ ...authForm, dateOfBirth: event.target.value })} className={`${inputClass} border-white/10 bg-[#20212a] py-3`} />
                    </label>
                  </>
                ) : (
                  <label className="block text-sm font-medium text-slate-300">Email or username#tag
                    <input required autoComplete="username" value={authForm.identifier} onChange={(event) => setAuthForm({ ...authForm, identifier: event.target.value })} className={`${inputClass} border-white/10 bg-[#20212a] py-3`} placeholder="you@example.com" />
                  </label>
                )}
                <label className="block text-sm font-medium text-slate-300">Password
                  <input required type="password" minLength={authMode === 'register' ? 8 : undefined} maxLength={128} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} className={`${inputClass} border-white/10 bg-[#20212a] py-3`} placeholder={authMode === 'register' ? 'At least 8 characters' : 'Your password'} />
                </label>
                {authMode === 'login' && authCodeRequired && <label className="block text-sm font-medium text-slate-300">Authenticator or backup code
                  <input required autoComplete="one-time-code" value={authTotpCode} onChange={(event) => setAuthTotpCode(event.target.value)} className={`${inputClass} border-white/10 bg-[#20212a] py-3`} placeholder="000000 or backup code" />
                </label>}
                {authError && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-sm text-rose-200">{authError}</p>}
                {error && <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2.5 text-sm text-amber-100">{error}</p>}
                <button type="submit" disabled={busy} className="mt-3 w-full rounded-full bg-[#b9baff] px-5 py-3.5 text-sm font-semibold text-[#171827] shadow-lg shadow-indigo-950/20 hover:bg-[#c9caff] disabled:cursor-wait disabled:opacity-60">
                  {busy ? 'Please wait…' : authMode === 'login' ? 'Log in' : 'Create account'}
                </button>
              </form>
              <p className="mt-5 text-center text-xs leading-5 text-slate-500">Accounts are stored securely. There are no demo credentials.</p>
            </div>
          </div>
          <footer className="flex items-center justify-center gap-6 py-6 text-xs text-slate-500">
            <a href="/terms" className="hover:text-slate-300">Terms</a>
            <a href="/privacy" className="hover:text-slate-300">Privacy</a>
          </footer>
        </section>
        <SuccessToast message={successToast} exiting={toastExiting} onDismiss={dismissSuccessToast} />
      </main>
    );
  }

  return (
    <main style={{ zoom: preferences ? preferences.appearance.zoom / 100 : 1, filter: `saturate(var(--cordly-saturation, 100%))` }} className="cordly-page-enter flex h-dvh min-h-[560px] overflow-hidden bg-cordly-bg text-cordly-text">
      <aside className="flex w-[68px] shrink-0 flex-col items-center gap-2 border-r border-cordly-border bg-cordly-surface py-3">
        <button type="button" title="Cordly home" aria-label={`Cordly home${unreadDmCount ? `, ${unreadDmCount} unread direct message${unreadDmCount === 1 ? '' : 's'}` : ''}`} onClick={() => { setWorkspace('friends'); setActiveDm(null); setMessages([]); }} className={`relative mb-1 flex h-11 w-11 items-center justify-center rounded-[16px] font-bold transition hover:rounded-card ${workspace === 'friends' ? 'bg-cordly-accent text-white' : 'bg-cordly-elevated text-cordly-text hover:bg-cordly-hover'}`}>C{unreadDmCount > 0 && <span aria-hidden="true" className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-cordly-surface bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">{unreadDmCount > 99 ? '99+' : unreadDmCount}</span>}</button>
        <div className="my-1 h-px w-8 bg-cordly-border" />
        {guilds.map((guild) => (
          <button key={guild.id} type="button" title={guild.name} aria-label={guild.name} onClick={() => {
            setWorkspace('servers');
            setActiveDm(null);
            if (activeGuildId === guild.id && workspace !== 'servers') {
              const cachedMessages = messageCacheRef.current.get(`channel:${activeChannelId}`) ?? [];
              messagesRef.current = cachedMessages;
              setMessages(cachedMessages);
            } else {
              setChannels([]);
              setCategories([]);
              setMembers([]);
              setMessages([]);
              setActiveChannelId('');
            }
            setActiveGuildId(guild.id);
          }} className={`flex h-11 w-11 items-center justify-center rounded-[16px] text-sm font-semibold transition hover:rounded-card ${activeGuildId === guild.id && workspace === 'servers' ? 'bg-cordly-accent text-white' : 'bg-cordly-elevated text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text'}`}>
            {initials(guild.name)}
          </button>
        ))}
        <button type="button" title={`Create or join a ${COMMUNITY_TERMS.singular.toLowerCase()}`} aria-label={`Add a ${COMMUNITY_TERMS.singular.toLowerCase()}`} onClick={() => {
          setServerDialogView('choose');
          setServerDialogOpen(true);
        }} className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-cordly-border text-xl text-cordly-success transition hover:rounded-card hover:border-cordly-success hover:bg-cordly-hover">+</button>
        <button type="button" onClick={openSettings} title="User settings" aria-label="User settings" className="relative mt-auto rounded-full">
          <UserAvatar username={account.username} avatarUrl={account.avatarUrl} sizeClass="h-11 w-11 text-sm" status={account.status} />
        </button>
      </aside>

      {workspace === 'servers' ? (
        <>
          <aside className="flex w-[260px] shrink-0 flex-col border-r border-cordly-border bg-cordly-surface max-sm:absolute max-sm:bottom-0 max-sm:left-[68px] max-sm:top-0 max-sm:z-20 max-sm:w-[min(280px,calc(100vw-68px))]">
            <div className="relative border-b border-cordly-border" ref={communityMenuRef}>
              <button type="button" disabled={!activeGuild} aria-haspopup="menu" aria-expanded={communityMenuOpen} onClick={() => {
                setCommunityMenuOpen((open) => !open);
                if (!communityMenuOpen) void loadCommunityPreferences();
              }} className="flex h-12 w-full items-center justify-between px-4 text-left hover:bg-cordly-hover disabled:cursor-default">
                <span className="truncate text-sm font-semibold">{activeGuild?.name ?? COMMUNITY_TERMS.plural}</span>
                <ChevronDown size={16} className={`shrink-0 text-cordly-secondary transition-transform ${communityMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {communityMenuOpen && activeGuild && (
                <div className="absolute left-2 right-2 top-[calc(100%+6px)] z-40">
                  <Menu label={`${activeGuild.name} community menu`} >
                    <MenuItem icon={<UserPlus size={16} />} disabled={!canManageMembers} onClick={() => { setCommunityMenuOpen(false); setCreatedInvite(''); setCommunityModal('invite'); }}>Invite members</MenuItem>
                    <MenuItem icon={<Settings size={16} />} disabled={!canManageMembers} onClick={() => {
                      setCommunityMenuOpen(false);
                      setCommunitySettingsPage('overview');
                      setCommunityNameDraft(activeGuild.name);
                      setDetachedBannerDraft(activeGuild.detachedBanner ?? false);
                      setCommunityModal('settings');
                    }}>Community settings</MenuItem>
                    <MenuItem icon={<Hash size={16} />} disabled={!canManageMembers} onClick={() => { setCommunityMenuOpen(false); setCommunityModal('channel'); }}>Create channel</MenuItem>
                    <MenuItem icon={<FolderPlus size={16} />} disabled={!canManageMembers} onClick={() => { setCommunityMenuOpen(false); setCommunityModal('category'); }}>Create category</MenuItem>
                    <MenuItem icon={<Bell size={16} />} onClick={() => { setCommunityMenuOpen(false); setCommunityModal('notifications'); }}>Notification settings</MenuItem>
                    <MenuItem icon={<Shield size={16} />} onClick={() => { setCommunityMenuOpen(false); setCommunityModal('privacy'); }}>Privacy settings</MenuItem>
                    <MenuItem icon={<Users size={16} />} onClick={() => { setCommunityMenuOpen(false); setCommunityModal('profile'); }}>Edit community profile</MenuItem>
                    <MenuItem icon={communityPreferences.hideMutedChannels ? <Check size={16} /> : undefined} onClick={() => void saveCommunityPreferences({ hideMutedChannels: !communityPreferences.hideMutedChannels })}>
                      {communityPreferences.hideMutedChannels ? 'Show muted channels' : 'Hide muted channels'}
                    </MenuItem>
                    {currentCommunityRole !== 'owner' && <div className="my-1 border-t border-cordly-border" />}
                    {currentCommunityRole !== 'owner' && <MenuItem icon={<LogOut size={16} />} danger onClick={() => { setCommunityMenuOpen(false); setCommunityModal('leave'); }}>Leave community</MenuItem>}
                  </Menu>
                </div>
              )}
            </div>

            {activeGuild ? (
              <>
                <div className="flex items-center gap-2 border-b border-cordly-border px-3 py-2">
                  <Search size={15} className="shrink-0 text-cordly-muted" />
                  <input value={channelSearch} onChange={(event) => setChannelSearch(event.target.value)} aria-label="Search channels" placeholder="Find a channel" className="min-w-0 flex-1 bg-transparent text-xs text-cordly-text outline-none placeholder:text-cordly-muted" />
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                  {favoriteChannels.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-cordly-muted"><span>Favorites</span><Star size={13} /></div>
                      {filteredChannels.filter((channel) => favoriteChannels.includes(channel.id)).map((channel) => <ChannelRow key={`favorite-${channel.id}`} channel={channel} active={activeChannelId === channel.id} favorite onSelect={() => selectChannel(channel.id)} onToggleFavorite={() => {
                        const next = favoriteChannels.filter((id) => id !== channel.id);
                        setFavoriteChannels(next);
                        void saveCommunityPreferences({ favoriteChannelIds: next });
                      }} />)}
                    </div>
                  )}
                  {categories.map((category) => (
                    <div key={category.id} className="mb-2">
                      <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-cordly-muted">{category.name}</div>
                      {filteredChannels.filter((channel) => channel.categoryId === category.id && !favoriteChannels.includes(channel.id)).map((channel) => <ChannelRow key={channel.id} channel={channel} active={activeChannelId === channel.id} favorite={favoriteChannels.includes(channel.id)} onSelect={() => selectChannel(channel.id)} onToggleFavorite={() => {
                        const next = favoriteChannels.includes(channel.id) ? favoriteChannels.filter((id) => id !== channel.id) : [...favoriteChannels, channel.id];
                        setFavoriteChannels(next);
                        void saveCommunityPreferences({ favoriteChannelIds: next });
                      }} />)}
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-cordly-muted">
                    <span>{categories.length ? 'Other channels' : 'Text channels'}</span>
                    {canManageMembers && <button type="button" title="Create channel" aria-label="Create channel" onClick={() => setCommunityModal('channel')} className="rounded p-1 hover:bg-cordly-hover"><Hash size={14} /></button>}
                  </div>
                  {filteredChannels.filter((channel) => !channel.categoryId && !favoriteChannels.includes(channel.id)).map((channel) => <ChannelRow key={channel.id} channel={channel} active={activeChannelId === channel.id} favorite={favoriteChannels.includes(channel.id)} onSelect={() => selectChannel(channel.id)} onToggleFavorite={() => {
                    const next = favoriteChannels.includes(channel.id) ? favoriteChannels.filter((id) => id !== channel.id) : [...favoriteChannels, channel.id];
                    setFavoriteChannels(next);
                    void saveCommunityPreferences({ favoriteChannelIds: next });
                  }} />)}
                  {filteredChannels.length === 0 && <p className="px-2 py-4 text-xs text-cordly-muted">{channelSearch ? 'No matching channels.' : 'No channels yet.'}</p>}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-cordly-border bg-cordly-surface px-3 py-2.5">
                  <div onContextMenu={(event) => openContextMenu(event, { kind: 'self', user: account })}><UserAccountPopover account={account} onStatusChange={(status) => void changeAccountStatus(status)} onSwitchAccount={() => { setAuthMode('login'); void logout(); }} onCopyUserId={() => void copyAccountId()} onEditProfile={openSettings} /></div>
                  <button type="button" onClick={openSettings} title="User settings" aria-label="User settings" className="rounded p-2 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text"><Settings size={17} /></button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                <p className="text-sm font-medium">No communities yet</p>
                <p className="mt-2 text-xs leading-5 text-cordly-muted">Join with an invite or create a community for your conversations.</p>
              </div>
            )}
          </aside>

          <section className="flex min-w-0 flex-1 flex-col bg-cordly-bg">
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-cordly-border px-4">
              <Hash size={18} className="text-cordly-muted" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-semibold">{activeChannel?.name ?? 'No channel selected'}</h1>
              </div>
              <span title={socketConnected ? 'Connected to real-time updates' : 'Reconnecting to real-time updates'} className={`flex items-center gap-1.5 text-[10px] ${socketConnected ? 'text-cordly-success' : 'text-cordly-muted'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${socketConnected ? 'bg-cordly-success' : 'bg-cordly-muted'}`} />
                {socketConnected ? 'Live' : 'Reconnecting'}
              </span>
              <div className="flex items-center gap-1">
                {([
                  { label: 'Channel notifications', icon: Bell, action: () => setCommunityModal('notifications') },
                  { label: 'Threads', icon: MessageSquare, action: () => setChannelPanel((panel) => panel === 'threads' ? null : 'threads') },
                  { label: 'Pinned messages', icon: Pin, action: () => setChannelPanel((panel) => panel === 'pins' ? null : 'pins') },
                ] as const).map(({ label, icon: Icon, action }) => <button key={label} type="button" title={label} aria-label={label} onClick={action} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text"><Icon size={17} /></button>)}
                <button type="button" title="Toggle favorite" aria-label="Toggle favorite" onClick={() => {
                  if (!activeChannel) return;
                  setFavoriteChannels((current) => current.includes(activeChannel.id) ? current.filter((id) => id !== activeChannel.id) : [...current, activeChannel.id]);
                }} className={`rounded-control p-2 hover:bg-cordly-hover ${activeChannel && favoriteChannels.includes(activeChannel.id) ? 'text-cordly-warning' : 'text-cordly-secondary hover:text-cordly-text'}`}><Star size={17} /></button>
                <button type="button" title="Search messages" aria-label="Search messages" onClick={() => setChannelSearchOpen((open) => !open)} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text"><Search size={17} /></button>
                <button type="button" title="Toggle member list" aria-label="Toggle member list" aria-pressed={membersOpen} onClick={() => setMembersOpen((open) => !open)} className={`rounded-control p-2 ${membersOpen ? 'text-cordly-text' : 'text-cordly-secondary'} hover:bg-cordly-hover`}><Users size={17} /></button>
              </div>
              {channelSearchOpen && <input autoFocus aria-label="Search messages" value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Search messages" className="absolute right-16 top-2 z-10 w-60 rounded-control border border-cordly-border bg-cordly-elevated px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-cordly" />}
            </header>

            {error && <div role="status" className="mx-4 mt-3 rounded-control border border-cordly-warning/30 bg-cordly-warning/10 px-3 py-2 text-sm text-cordly-text">{error}<button type="button" onClick={() => setError('')} className="ml-3 text-cordly-warning">Dismiss</button></div>}

            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                {activeChannel ? (
                  <>
                    <div className="flex-1 space-y-1 overflow-y-auto px-4 py-5">
                      {messages.length === 0 ? (
                        <div className="flex h-full min-h-[220px] flex-col justify-end pb-8">
                          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-cordly-border bg-cordly-surface text-2xl text-cordly-secondary"><Hash size={27} /></div>
                          <h2 className="text-xl font-semibold">Welcome to #{activeChannel.name}</h2>
                          <p className="mt-2 max-w-sm text-sm leading-6 text-cordly-secondary">In the beginning, there was nothing. Then, there was #{activeChannel.name}. And it was good.</p>
                        </div>
                      ) : (
                        messages.filter((message) => matchesMessageSearch(message, messageSearch, activeChannel.name, account)).map((message, index, visible) => {
                          const previous = visible[index - 1];
                          const grouped = previous?.author.id === message.author.id && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 7 * 60_000;
                          const highlighted = message.content.toLowerCase().includes(`@${account.username.toLowerCase()}`) || /@(everyone|here)\b/i.test(message.content);
                          const dateLabel = new Date(message.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                          const previousDate = previous ? new Date(previous.createdAt).toDateString() : '';
                          return (
                            <div key={message.id} className="cordly-message-enter">
                              {(!previous || previousDate !== new Date(message.createdAt).toDateString()) && <div className="my-5 flex items-center gap-3 text-[11px] text-cordly-muted"><span className="h-px flex-1 bg-cordly-border" /><time>{dateLabel}</time><span className="h-px flex-1 bg-cordly-border" /></div>}
                              <article onContextMenu={(event) => openContextMenu(event, { kind: 'message', message, direct: false })} style={highlighted ? { backgroundColor: 'rgba(240,178,50,0.08)', borderLeftColor: 'var(--warning)' } : undefined} className={`group relative flex gap-3 rounded-control border-l-2 px-2 py-1.5 ${highlighted ? '' : 'border-transparent'} hover:bg-cordly-hover ${grouped ? 'pl-2' : ''}`}>
                                {grouped ? <time className="w-8 shrink-0 pt-1 text-right text-[10px] text-cordly-muted opacity-0 group-hover:opacity-100">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> : <UserAvatar username={message.author.username} avatarUrl={message.author.avatarUrl} sizeClass="mt-0.5 h-9 w-9 text-xs" />}
                                <div className="min-w-0 flex-1">
                                  {!grouped && <div className="flex flex-wrap items-baseline gap-x-2"><button type="button" onClick={() => void openUserProfile(message.author.id)} onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, { kind: message.author.id === account.id ? 'self' : 'user', user: message.author }); }} className="text-sm font-semibold text-cordly-text hover:underline">{message.author.username}</button><span className="text-[11px] text-cordly-muted">#{message.author.tag}</span><time className="text-[11px] text-cordly-muted" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>}
                                  {message.replyToId && <p className="mb-1 text-[11px] text-cordly-muted">↳ Reply to {messages.find((item) => item.id === message.replyToId)?.author.username ?? 'a message'}</p>}
                                  {message.content && <div className="whitespace-pre-wrap break-words text-sm leading-6 text-cordly-text"><MessageContent content={message.content} onMemberMention={(name) => {
                                    const member = members.find((item) => item.username.toLowerCase() === name.toLowerCase());
                                    if (member) void openUserProfile(member.id);
                                  }} />{message.editedAt && <span className="ml-1 text-[10px] text-cordly-muted">(edited)</span>}</div>}
                                  {message.attachments.map((attachment) => attachment.contentType.startsWith('image/')
                                    ? <Image key={attachment.id} src={attachment.url} alt={attachment.filename} width={440} height={320} unoptimized className="mt-2 max-h-80 w-auto max-w-full rounded-card object-contain" />
                                    : attachment.contentType.startsWith('video/')
                                      ? <video key={attachment.id} src={attachment.url} controls preload="metadata" className="mt-2 max-h-80 max-w-full rounded-card" />
                                      : <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block max-w-sm truncate rounded-card border border-cordly-border bg-cordly-surface px-3 py-2 text-xs text-indigo-300 underline">{attachment.filename} · {Math.ceil(attachment.size / 1024)} KB</a>)}
                                  {message.pinned && <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-cordly-warning"><Pin size={11} />Pinned</div>}
                                  {message.reactions.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{message.reactions.map((reaction) => <button key={reaction.emoji} type="button" aria-pressed={reaction.reacted} onClick={() => void actOnMessage(message, 'react', reaction.emoji as '👍' | '❤️' | '😂' | '🎉' | '👀')} className={`rounded-full border px-2 py-1 text-xs ${reaction.reacted ? 'border-cordly-accent bg-cordly-accent/20' : 'border-cordly-border hover:bg-cordly-hover'}`}>{reaction.emoji} {reaction.count}</button>)}</div>}
                                </div>
                                <div className="absolute right-2 top-0 hidden -translate-y-1/2 items-center rounded-control border border-cordly-border bg-cordly-elevated p-1 group-hover:flex group-focus-within:flex">
                                  <button type="button" title="React" aria-label="React with thumbs up" onClick={() => void actOnMessage(message, 'react', '👍')} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><ThumbsUp size={14} /></button>
                                  <button type="button" title="Reply" aria-label="Reply to message" onClick={() => { setReplyTarget(message); setEditingMessage(null); }} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><Reply size={14} /></button>
                                  {message.author.id === account.id && <button type="button" title="Edit" aria-label="Edit message" onClick={() => actOnMessage(message, 'edit')} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><Pencil size={14} /></button>}
                                  {canManageMembers && <button type="button" title={message.pinned ? 'Unpin' : 'Pin'} aria-label={message.pinned ? 'Unpin message' : 'Pin message'} onClick={() => void actOnMessage(message, 'pin')} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><Pin size={14} /></button>}
                                  {message.author.id === account.id && <button type="button" title="Delete" aria-label="Delete message" onClick={() => void actOnMessage(message, 'delete')} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-danger"><Trash2 size={14} /></button>}
                                  <button type="button" title="Copy message link" aria-label="Copy message link" onClick={() => {
                                    const url = new URL(window.location.href);
                                    url.searchParams.set('channel', activeChannel.id);
                                    url.searchParams.set('message', message.id);
                                    void navigator.clipboard.writeText(url.toString()).then(() => notifySuccess('Message link copied')).catch((copyError: unknown) => setError(getErrorMessage(copyError)));
                                  }} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><LinkIcon size={14} /></button>
                                  <button type="button" title="Report" aria-label="Report message" onClick={() => void actOnMessage(message, 'report')} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><Flag size={14} /></button>
                                  {preferences?.developerMode && <button type="button" title="Copy message id" aria-label="Copy message id" onClick={() => void navigator.clipboard.writeText(message.id)} className="rounded p-1.5 text-cordly-secondary hover:bg-cordly-hover"><Copy size={14} /></button>}
                                </div>
                              </article>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <form onSubmit={sendMessage} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadFiles(event.dataTransfer.files); }} className="relative px-4 pb-4">
                      {visibleTypingUsers.length > 0 && <p className="mb-1 px-2 text-[11px] text-cordly-secondary">{visibleTypingUsers.slice(0, 3).join(', ')} {visibleTypingUsers.length === 1 ? 'is' : 'are'} typing…</p>}
                      {(replyTarget || editingMessage) && <div className="mb-2 flex items-center justify-between rounded-control border border-cordly-border bg-cordly-surface px-3 py-2 text-xs text-cordly-secondary"><span>{editingMessage ? 'Editing your message' : `Replying to ${replyTarget?.author.username}`}</span><button type="button" aria-label="Cancel reply or edit" onClick={() => { setReplyTarget(null); setEditingMessage(null); setMessageDraft(''); }} className="rounded p-1 hover:bg-cordly-hover"><X size={14} /></button></div>}
                      {messageAttachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{messageAttachments.map((attachment) => <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-control border border-cordly-border bg-cordly-surface px-2 py-1.5 text-xs"><span className="max-w-48 truncate">{attachment.filename}</span><button type="button" aria-label={`Remove ${attachment.filename}`} onClick={() => setMessageAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="text-cordly-muted hover:text-cordly-danger"><X size={13} /></button></div>)}</div>}
                      <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
                      <div className="flex items-end gap-2 rounded-modal border border-cordly-border bg-cordly-surface p-2 focus-within:border-cordly-accent">
                        <button type="button" title="Upload a file" aria-label="Upload a file" onClick={() => { if (fileInputRef.current) fileInputRef.current.accept = ''; fileInputRef.current?.click(); }} disabled={attachmentBusy} className="rounded-full p-2 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text disabled:opacity-50"><Paperclip size={18} /></button>
                        <textarea aria-label={`Message #${activeChannel.name}`} value={messageDraft} onChange={(event) => { setMessageDraft(event.target.value); if (account && activeChannel) { try { localStorage.setItem(`cordly-draft:${account.id}:${activeChannel.id}`, event.target.value); } catch (storageError) { setError(getErrorMessage(storageError)); } } sendTypingSignal(Boolean(event.target.value.trim())); }} onPaste={(event) => {
                          const pastedFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
                          if (pastedFiles.length) { event.preventDefault(); void uploadFiles(pastedFiles); }
                        }} onKeyDown={(event) => {
                          if (event.key === 'ArrowUp' && !messageDraft && messages.at(-1)?.author.id === account.id) {
                            event.preventDefault();
                            const last = messages.at(-1);
                            if (last) void actOnMessage(last, 'edit');
                          }
                          if (event.key === 'Enter' && !event.shiftKey && (!preferences || preferences.chat.sendOnEnter)) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }} maxLength={4000} rows={1} className="max-h-40 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-cordly-muted" placeholder={`Message #${activeChannel.name}`} />
                        <button type="button" title="Upload image" aria-label="Upload image" onClick={() => { if (fileInputRef.current) fileInputRef.current.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif'; fileInputRef.current?.click(); }} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><ImageIcon size={17} /></button>
                        <button type="button" title="Emoji picker" aria-label="Emoji picker" aria-expanded={emojiPickerOpen} onClick={() => { setEmojiPickerOpen((open) => !open); setStickerPickerOpen(false); }} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Smile size={17} /></button>
                        <button type="button" title="Sticker picker" aria-label="Sticker picker" aria-expanded={stickerPickerOpen} onClick={() => { setStickerPickerOpen((open) => !open); setEmojiPickerOpen(false); }} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Sticker size={17} /></button>
                        <button type="submit" disabled={attachmentBusy || (!messageDraft.trim() && messageAttachments.length === 0)} className="rounded-control bg-cordly-accent px-4 py-2 text-sm font-semibold text-white hover:bg-cordly-accent-hover disabled:opacity-50">{editingMessage ? 'Save' : 'Send'}</button>
                      </div>
                      {emojiPickerOpen && <div className="absolute bottom-20 right-16 z-20 grid grid-cols-5 gap-1 rounded-card border border-cordly-border bg-cordly-elevated p-2">{['👍', '❤️', '😂', '🎉', '👀', '🙂', '😄', '✨', '🙌', '🤔'].map((emoji) => <button key={emoji} type="button" onClick={() => { setMessageDraft((current) => `${current}${emoji}`); setEmojiPickerOpen(false); }} className="rounded p-2 text-lg hover:bg-cordly-hover">{emoji}</button>)}</div>}
                      {stickerPickerOpen && <div className="absolute bottom-20 right-8 z-20 rounded-card border border-cordly-border bg-cordly-elevated p-4 text-xs text-cordly-muted">This community has no stickers yet.</div>}
                      <p className="mt-1 px-2 text-[10px] text-cordly-muted">{attachmentBusy ? 'Uploading files…' : 'Enter to send · Shift+Enter for a new line · Drop files to attach'}</p>
                    </form>
                  </>
                ) : <div className="flex flex-1 flex-col items-center justify-center px-6 text-center"><h2 className="text-xl font-semibold">{`Make ${COMMUNITY_TERMS.singular.toLowerCase()} yours`}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-cordly-secondary">Create or join a community. Its channels and conversations will appear here.</p></div>}
              </div>

              {membersOpen && activeGuild && (
                <aside className="w-60 shrink-0 overflow-y-auto border-l border-cordly-border bg-cordly-bg p-3 max-lg:absolute max-lg:bottom-0 max-lg:right-0 max-lg:top-12 max-lg:z-10 max-lg:bg-cordly-surface">
                  {(['online', 'offline'] as const).map((status) => {
                    const groupedMembers = members.filter((member) => status === 'online' ? member.status !== 'offline' : member.status === 'offline');
                    if (groupedMembers.length === 0) return null;
                    return <section key={status} className="mb-5">
                      <h2 className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-cordly-muted">{status === 'online' ? 'Online' : 'Offline'}—{groupedMembers.length}</h2>
                      {groupedMembers.map((member) => <button key={member.id} type="button" onClick={() => void openUserProfile(member.id)} onContextMenu={(event) => openContextMenu(event, { kind: 'user', user: member })} className="cordly-row-enter flex w-full items-center gap-2 rounded-control px-2 py-2 text-left hover:bg-cordly-hover">
                        <UserAvatar username={member.username} avatarUrl={member.avatarUrl} sizeClass="h-8 w-8 text-[10px]" status={member.status} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-cordly-secondary">{member.username}</span>
                        {member.owner && <Crown size={13} className="text-cordly-warning" aria-label="Community owner" />}
                      </button>)}
                    </section>;
                  })}
                </aside>
              )}
              {channelPanel && <aside className="w-64 shrink-0 overflow-y-auto border-l border-cordly-border bg-cordly-surface p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{channelPanel === 'pins' ? 'Pinned messages' : 'Threads'}</h2><button type="button" onClick={() => setChannelPanel(null)} aria-label="Close panel" className="rounded p-1 text-cordly-secondary hover:bg-cordly-hover"><X size={16} /></button></div>{(channelPanel === 'pins' ? messages.filter((message) => message.pinned) : messages.filter((message) => message.replyToId)).length === 0 ? <p className="mt-5 text-xs text-cordly-muted">{channelPanel === 'pins' ? 'No pinned messages in this channel.' : 'No active threads in this channel.'}</p> : <div className="mt-4 space-y-2">{(channelPanel === 'pins' ? messages.filter((message) => message.pinned) : messages.filter((message) => message.replyToId)).map((message) => <button key={message.id} type="button" onClick={() => { setChannelPanel(null); setMessageSearch(''); }} className="block w-full rounded-control border border-cordly-border p-3 text-left hover:bg-cordly-hover"><span className="text-xs font-semibold">{message.author.username}</span><span className="mt-1 block truncate text-xs text-cordly-secondary">{message.content || 'Attachment'}</span></button>)}</div>}</aside>}
            </div>
          </section>
        </>
      ) : (
        <>
        <aside className="hidden w-[240px] shrink-0 flex-col border-r border-cordly-border bg-cordly-surface sm:flex">
        <div className="border-b border-cordly-border p-3">
          <div className="rounded-control bg-cordly-elevated px-2.5 py-2 text-xs text-cordly-secondary">Friends and messages</div>
        </div>
        <button type="button" onClick={() => { setActiveDm(null); setMessages([]); }} className={`mx-2 mt-3 flex items-center gap-3 rounded-control px-3 py-2.5 text-left text-sm ${activeDm ? 'text-cordly-secondary hover:bg-cordly-hover' : 'bg-cordly-active text-cordly-text'}`}>
          <Users size={17} /> Friends
        </button>
        <div className="flex items-center justify-between px-4 pb-2 pt-6 text-[10px] font-bold uppercase tracking-wider text-cordly-muted"><span>Direct messages</span><button type="button" onClick={() => setDmPickerOpen((open) => !open)} title="Start a direct message" aria-label="Start a direct message" className="rounded p-1 hover:bg-cordly-hover hover:text-cordly-text"><UserPlus size={14} /></button></div>
        {dmPickerOpen && <div className="mx-2 mb-2 max-h-40 overflow-y-auto rounded-control border border-cordly-border bg-cordly-elevated p-1">{friends.filter((relation) => relation.status === 'accepted').map((relation) => <button key={relation.id} type="button" onClick={() => { setDmPickerOpen(false); void openDirectMessage(relation.user); }} className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-xs hover:bg-cordly-hover"><UserAvatar username={relation.user.username} avatarUrl={relation.user.avatarUrl} sizeClass="h-7 w-7 text-[9px]" status={relation.user.status} /><span className="truncate">{relation.user.username}</span></button>)}{friends.every((relation) => relation.status !== 'accepted') && <p className="px-2 py-2 text-[11px] text-cordly-muted">Add a friend to start a conversation.</p>}</div>}
        <div className="flex-1 overflow-y-auto px-2">
          {directConversations.length ? directConversations.map((conversation) => {
            const unread = unreadDmCount > 0 && unreadDmIds.has(conversation.id);
            return (
              <button key={conversation.id} type="button" aria-label={`${conversation.user.username}${unread ? ', unread message' : ''}`} onContextMenu={(event) => openContextMenu(event, { kind: 'user', user: conversation.user })} onClick={() => selectDirectConversation(conversation)} className={`cordly-row-enter flex w-full min-w-0 items-center gap-2 rounded-control px-2 py-2 text-left ${activeDm?.id === conversation.id ? 'bg-cordly-active text-cordly-text' : 'text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text'}`}>
                <UserAvatar username={conversation.user.username} avatarUrl={conversation.user.avatarUrl} sizeClass="h-8 w-8 text-[10px]" status={conversation.user.status} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs ${unread ? 'font-bold text-cordly-text' : 'font-medium'}`}>{conversation.user.username}</span>
                  <span className={`block truncate text-[10px] ${unread ? 'text-cordly-text' : 'text-cordly-muted'}`}>{conversation.lastMessage?.content || (conversation.lastMessage ? 'Attachment' : `#${conversation.user.tag}`)}</span>
                </span>
                {unread && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />}
              </button>
            );
          }) : <p className="px-3 py-2 text-xs leading-5 text-cordly-muted">Your direct messages will appear here.</p>}
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-cordly-border bg-cordly-surface p-3">
          <div onContextMenu={(event) => openContextMenu(event, { kind: 'self', user: account })}><UserAccountPopover account={account} onStatusChange={(status) => void changeAccountStatus(status)} onSwitchAccount={() => { setAuthMode('login'); void logout(); }} onCopyUserId={() => void copyAccountId()} onEditProfile={openSettings} /></div>
          <div className="flex items-center">
            <button type="button" onClick={openSettings} title="User settings" aria-label="User settings" className="rounded-control p-2 text-cordly-muted hover:bg-cordly-hover hover:text-cordly-text"><Settings size={16} /></button>
            <button type="button" onClick={() => void logout()} title="Sign out" className="rounded-control p-2 text-xs text-cordly-muted hover:bg-cordly-hover hover:text-cordly-text">↪</button>
          </div>
        </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col bg-cordly-bg">
        {activeDm ? (
          <>
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-cordly-border px-4">
            <UserAvatar username={activeDm.user.username} avatarUrl={activeDm.user.avatarUrl} sizeClass="h-8 w-8 text-[10px]" status={activeDm.user.status} />
            <button type="button" onClick={() => void openUserProfile(activeDm.user.id, true)} className="min-w-0 truncate text-sm font-semibold hover:underline">{activeDm.user.username}<span className="ml-1 text-xs font-normal text-cordly-muted">#{activeDm.user.tag}</span></button>
            <span title={socketConnected ? 'Connected to real-time updates' : 'Reconnecting to real-time updates'} className={`flex items-center gap-1.5 text-[10px] ${socketConnected ? 'text-cordly-success' : 'text-cordly-muted'}`}><span className={`h-1.5 w-1.5 rounded-full ${socketConnected ? 'bg-cordly-success' : 'bg-cordly-muted'}`} />{socketConnected ? 'Live' : 'Reconnecting'}</span>
            <div className="ml-auto flex items-center gap-2">
              {dmSearchOpen && <input autoFocus value={dmSearch} onChange={(event) => setDmSearch(event.target.value)} aria-label="Search direct messages" placeholder="Search messages" className="w-48 rounded-full border border-cordly-border bg-cordly-elevated px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-cordly-accent" />}
              <button type="button" onClick={() => { setDmSearchOpen((open) => !open); setDmSearch(''); }} title="Search messages" aria-label="Search messages" className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Search size={17} /></button>
              <button type="button" onClick={() => void openUserProfile(activeDm.user.id, true)} title="View profile" aria-label="View profile" className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Users size={17} /></button>
            </div>
          </header>
          {error && <div role="status" className="mx-5 mt-4 rounded-control border border-cordly-danger/30 bg-cordly-danger/10 px-4 py-2.5 text-sm text-cordly-text">{error}<button type="button" onClick={() => setError('')} className="ml-3 text-cordly-secondary">Dismiss</button></div>}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
              {messages.filter((message) => !dmSearch || message.content.toLowerCase().includes(dmSearch.toLowerCase())).length === 0 ? (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                  <UserAvatar username={activeDm.user.username} avatarUrl={activeDm.user.avatarUrl} sizeClass="h-20 w-20 text-2xl" status={activeDm.user.status} />
                  <h1 className="mt-5 text-xl font-bold">{activeDm.user.username}<span className="ml-1 text-base font-normal text-cordly-secondary">#{activeDm.user.tag}</span></h1>
                  <p className="mt-5 text-sm text-cordly-secondary">Say hello to <span className="font-semibold text-cordly-text">{activeDm.user.username}</span>. Your conversation starts here.</p>
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-4xl flex-col justify-end gap-5">
                  {messages.filter((message) => !dmSearch || message.content.toLowerCase().includes(dmSearch.toLowerCase())).map((message) => (
                    <article key={message.id} onContextMenu={(event) => openContextMenu(event, { kind: 'message', message, direct: true })} className="cordly-message-enter flex gap-3 rounded-control px-2 py-1 hover:bg-cordly-hover">
                      <div onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, { kind: message.author.id === account.id ? 'self' : 'user', user: message.author }); }}><UserAvatar username={message.author.username} avatarUrl={message.author.avatarUrl} sizeClass="h-9 w-9 text-xs" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2"><button type="button" onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, { kind: message.author.id === account.id ? 'self' : 'user', user: message.author }); }} onClick={() => void openUserProfile(message.author.id)} className="text-sm font-semibold hover:underline">{message.author.username}</button><time dateTime={message.createdAt} className="text-[10px] text-cordly-muted">{new Date(message.createdAt).toLocaleString()}</time></div>
                        {message.content && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-cordly-text">{message.content}</p>}
                        {message.attachments.map((attachment) => attachment.contentType.startsWith('image/')
                          ? <Image key={attachment.id} src={attachment.url} alt={attachment.filename} width={440} height={320} unoptimized className="mt-2 max-h-80 w-auto max-w-full rounded-card object-contain" />
                          : attachment.contentType.startsWith('video/')
                            ? <video key={attachment.id} src={attachment.url} controls preload="metadata" className="mt-2 max-h-80 max-w-full rounded-card" />
                            : <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block max-w-sm truncate rounded-card border border-cordly-border bg-cordly-surface px-3 py-2 text-xs text-indigo-300 underline">{attachment.filename} · {Math.ceil(attachment.size / 1024)} KB</a>)}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
            <form onSubmit={(event) => void sendMessage(event)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void uploadFiles(event.dataTransfer.files); }} className="relative border-t border-cordly-border p-4 sm:px-8">
              {visibleTypingUsers.length > 0 && <p className="mx-auto mb-1 max-w-4xl px-2 text-[11px] text-cordly-secondary">{visibleTypingUsers.slice(0, 3).join(', ')} {visibleTypingUsers.length === 1 ? 'is' : 'are'} typing…</p>}
              {messageAttachments.length > 0 && <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-2">{messageAttachments.map((attachment) => <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-control border border-cordly-border bg-cordly-surface px-2 py-1.5 text-xs"><span className="max-w-48 truncate">{attachment.filename}</span><button type="button" aria-label={`Remove ${attachment.filename}`} onClick={() => setMessageAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="text-cordly-muted hover:text-cordly-danger"><X size={13} /></button></div>)}</div>}
              <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
              <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-card border border-cordly-border bg-cordly-surface p-2">
                <button type="button" title="Upload a file" aria-label="Upload a file" onClick={() => { if (fileInputRef.current) fileInputRef.current.accept = ''; fileInputRef.current?.click(); }} disabled={attachmentBusy} className="rounded-full p-2 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text disabled:opacity-50"><Paperclip size={18} /></button>
                <textarea value={messageDraft} onChange={(event) => { setMessageDraft(event.target.value); if (account) { try { localStorage.setItem(`cordly-draft:${account.id}:dm:${activeDm.id}`, event.target.value); } catch (storageError) { setError(getErrorMessage(storageError)); } } sendTypingSignal(Boolean(event.target.value.trim())); }} onPaste={(event) => {
                  const pastedFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
                  if (pastedFiles.length) { event.preventDefault(); void uploadFiles(pastedFiles); }
                }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && (!preferences || preferences.chat.sendOnEnter)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} aria-label={`Message ${activeDm.user.username}`} placeholder={`Message ${activeDm.user.username}`} maxLength={4000} rows={1} className="max-h-40 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-cordly-muted" />
                <button type="button" title="Upload image" aria-label="Upload image" onClick={() => { if (fileInputRef.current) fileInputRef.current.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif'; fileInputRef.current?.click(); }} disabled={attachmentBusy} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover disabled:opacity-50"><ImageIcon size={17} /></button>
                <button type="button" title="Emoji picker" aria-label="Emoji picker" aria-expanded={emojiPickerOpen} onClick={() => { setEmojiPickerOpen((open) => !open); setStickerPickerOpen(false); }} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Smile size={17} /></button>
                <button type="button" title="Sticker picker" aria-label="Sticker picker" aria-expanded={stickerPickerOpen} onClick={() => { setStickerPickerOpen((open) => !open); setEmojiPickerOpen(false); }} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Sticker size={17} /></button>
                <button type="submit" disabled={attachmentBusy || (!messageDraft.trim() && messageAttachments.length === 0)} className="rounded-control bg-cordly-accent px-4 py-2 text-sm font-semibold text-white hover:bg-cordly-accent-hover disabled:opacity-50">Send</button>
              </div>
              {emojiPickerOpen && <div className="absolute bottom-20 right-16 z-20 grid grid-cols-5 gap-1 rounded-card border border-cordly-border bg-cordly-elevated p-2">{['👍', '❤️', '😂', '🎉', '👀', '🙂', '😄', '✨', '🙌', '🤔'].map((emoji) => <button key={emoji} type="button" onClick={() => { setMessageDraft((current) => `${current}${emoji}`); setEmojiPickerOpen(false); }} className="rounded p-2 text-lg hover:bg-cordly-hover">{emoji}</button>)}</div>}
              {stickerPickerOpen && <div className="absolute bottom-20 right-8 z-20 rounded-card border border-cordly-border bg-cordly-elevated p-4 text-xs text-cordly-muted">This conversation has no stickers yet.</div>}
              <p className="mx-auto mt-1 max-w-4xl px-2 text-[10px] text-cordly-muted">{attachmentBusy ? 'Uploading files…' : 'Enter to send · Shift+Enter for a new line · Drop files to attach'}</p>
            </form>
          </div>
          </>
        ) : (
        <>
        <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-cordly-border px-4 sm:px-5">
          <div className="flex items-center gap-2 border-r border-cordly-border pr-4">
            <Users size={17} className="text-cordly-secondary" />
            <h1 className="text-sm font-semibold">My friends</h1>
          </div>
          <nav aria-label="Friend filters" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {(['all', 'online', 'pending'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => { setFriendFilter(filter); setAddFriendOpen(false); }}
                className={`whitespace-nowrap rounded-control px-3 py-1.5 text-xs capitalize transition ${
                  friendFilter === filter ? 'bg-cordly-active font-medium text-cordly-text' : 'text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text'
                }`}
              >
                {filter === 'all' ? 'All' : filter === 'online' ? 'Online' : 'Pending'}
              </button>
            ))}
            <button type="button" onClick={() => setAddFriendOpen(true)} className="whitespace-nowrap rounded-control bg-cordly-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-cordly-accent-hover">
              Add friend
            </button>
          </nav>
          <button type="button" onClick={() => void refreshFriends()} title="Refresh friends" aria-label="Refresh friends" className="rounded-control p-2 text-cordly-success hover:bg-cordly-hover"><Activity size={16} /></button>
        </header>
        {error && <div role="status" className="mx-5 mt-3 rounded-control border border-cordly-danger/30 bg-cordly-danger/10 px-4 py-2.5 text-sm text-cordly-text">{error}<button type="button" onClick={() => setError('')} className="ml-3 text-cordly-secondary">Dismiss</button></div>}
        {addFriendOpen ? (
          <div className="flex flex-1 flex-col items-center justify-center px-5">
            <div className="w-full max-w-md text-center">
              <UserPlus size={38} className="mx-auto text-cordly-accent" />
              <h2 className="mt-4 text-xl font-semibold">Add a friend</h2>
              <p className="mt-2 text-sm text-cordly-secondary">Connect using their exact username and tag.</p>
              <form onSubmit={sendFriendRequest} className="mt-6 flex gap-2 rounded-control border border-cordly-border bg-cordly-surface p-1.5">
                <input required aria-label="Friend username and tag" value={friendIdentifier} onChange={(event) => setFriendIdentifier(event.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-cordly-muted" placeholder="Username#0000" />
                <button type="submit" className="rounded-control bg-cordly-accent px-4 py-2 text-xs font-semibold text-white hover:bg-cordly-accent-hover">Send request</button>
              </form>
            </div>
          </div>
        ) : (
        <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-cordly-border px-4 py-2 sm:px-5">
          <label className="flex w-full items-center gap-2 rounded-control border border-cordly-border bg-cordly-elevated px-3 py-2 text-cordly-secondary focus-within:ring-2 focus-within:ring-cordly-accent">
            <Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Search friends" value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder={friendFilter === 'pending' ? 'Search pending requests' : friendFilter === 'online' ? 'Search online friends' : 'Search friends'} className="w-full bg-transparent text-xs text-cordly-text outline-none placeholder:text-cordly-muted" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-cordly-muted">{friendFilter === 'pending' ? 'Pending requests' : friendFilter === 'online' ? 'Online friends' : 'All friends'} — {visibleFriends.length}</h2>
          {visibleFriends.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Users size={34} className="text-cordly-muted" />
              <p className="mt-4 text-sm font-medium">{friendFilter === 'pending' ? 'No pending requests' : friendFilter === 'online' ? 'No friends online' : 'Your friends list is empty'}</p>
              <p className="mt-2 max-w-sm text-xs text-cordly-secondary">{friendFilter === 'pending' ? 'Friend requests sent to you will appear here.' : 'When you add friends, they will show up here.'}</p>
              {friendFilter !== 'pending' && <button type="button" onClick={() => setAddFriendOpen(true)} className="mt-4 rounded-control bg-cordly-accent px-3 py-2 text-xs font-semibold text-white hover:bg-cordly-accent-hover">Add friend</button>}
            </div>
          ) : (
            visibleFriends.map((relation) => (
              <div key={relation.id} onContextMenu={(event) => openContextMenu(event, { kind: 'user', user: relation.user })} className="cordly-row-enter mb-2 flex min-h-[64px] items-center gap-3 rounded-control border border-transparent px-2 transition hover:border-cordly-border hover:bg-cordly-surface">
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar username={relation.user.username} avatarUrl={relation.user.avatarUrl} sizeClass="h-9 w-9 text-xs" status={relation.user.status} />
                  <div className="min-w-0">
                    <button type="button" onClick={() => void openUserProfile(relation.user.id, true)} onContextMenu={(event) => { event.stopPropagation(); openContextMenu(event, { kind: 'user', user: relation.user }); }} className="block max-w-full truncate text-left text-sm font-medium hover:underline">{relation.user.username}<span className="ml-1 text-[11px] font-normal text-cordly-muted">#{relation.user.tag}</span></button>
                    <span className="block text-[10px] capitalize text-cordly-secondary">{relation.status === 'accepted' ? relation.user.status : relation.incoming ? 'Incoming request' : 'Request sent'}</span>
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {relation.status === 'accepted' && <button type="button" onClick={() => void openDirectMessage(relation.user)} title={`Message ${relation.user.username}`} aria-label={`Message ${relation.user.username}`} className="rounded-control border border-cordly-border p-2 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text"><MessageSquare size={15} /></button>}
                  {relation.status === 'pending' && relation.incoming && (
                    <><button type="button" onClick={() => void answerFriendRequest(relation.id, 'accept')} className="rounded-control bg-cordly-success/15 px-3 py-2 text-xs font-medium text-cordly-success hover:bg-cordly-success/25">Accept</button><button type="button" onClick={() => void answerFriendRequest(relation.id, 'decline')} className="rounded-control border border-cordly-border px-3 py-2 text-xs font-medium text-cordly-secondary hover:bg-cordly-hover">Deny</button><button type="button" onClick={() => void answerFriendRequest(relation.id, 'block')} className="rounded-control border border-cordly-danger/30 px-3 py-2 text-xs font-medium text-cordly-danger hover:bg-cordly-danger/10">Block</button></>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        </div>
        <aside className="hidden w-[240px] shrink-0 border-l border-cordly-border p-4 lg:block">
          <h2 className="text-sm font-semibold">Active now</h2>
          {friends.filter((relation) => relation.status === 'accepted' && relation.user.status !== 'offline').length ? <div className="mt-4 space-y-2">{friends.filter((relation) => relation.status === 'accepted' && relation.user.status !== 'offline').map((relation) => <button key={relation.id} type="button" onClick={() => void openDirectMessage(relation.user)} className="flex w-full items-center gap-2 rounded-control p-2 text-left hover:bg-cordly-hover"><UserAvatar username={relation.user.username} avatarUrl={relation.user.avatarUrl} sizeClass="h-8 w-8 text-[10px]" status={relation.user.status} /><span className="truncate text-xs font-medium">{relation.user.username}</span></button>)}</div> : <div className="flex h-[calc(100%-2rem)] flex-col items-center justify-center text-center"><Activity size={28} className="text-cordly-muted" /><p className="mt-3 text-xs font-semibold">Nothing happening yet</p><p className="mt-1 text-[10px] leading-4 text-cordly-muted">Friends who are available will appear here.</p></div>}
        </aside>
        </div>
        )}
        </>
        )}
        </section>
        </>
      )}
      {activeGuild && communityModal === 'invite' && (
        <Modal open onClose={() => setCommunityModal(null)} title="Invite members">
          <p className="mb-4 text-sm text-cordly-secondary">Choose how long this invite stays active and how many people can use it.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-cordly-secondary">Expires after
              <select value={inviteExpiry} onChange={(event) => setInviteExpiry(Number(event.target.value))} className={`${inputClass} mt-2`}>
                <option value={24}>24 hours</option><option value={168}>7 days</option><option value={0}>Never</option>
              </select>
            </label>
            <label className="text-xs font-medium text-cordly-secondary">Maximum uses
              <select value={inviteMaxUses} onChange={(event) => setInviteMaxUses(Number(event.target.value))} className={`${inputClass} mt-2`}>
                <option value={0}>Unlimited</option><option value={1}>1 use</option><option value={5}>5 uses</option><option value={10}>10 uses</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={() => void createCommunityInvite()} className={`${buttonClass} mt-5`}>Create invite link</button>
          {createdInvite && <div className="mt-4 flex gap-2"><input readOnly value={`${typeof window === 'undefined' ? '' : window.location.origin}/?invite=${createdInvite}`} className={`${inputClass} mt-0`} aria-label="Invite link" /><button type="button" onClick={() => void copyCreatedInvite()} title="Copy invite link" aria-label="Copy invite link" className="rounded-control border border-cordly-border px-3 text-cordly-secondary hover:bg-cordly-hover"><Copy size={17} /></button></div>}
        </Modal>
      )}
      {communityModal === 'channel' && (
        <Modal open onClose={() => setCommunityModal(null)} title="Create a channel">
          <form onSubmit={createChannel} className="space-y-4">
            <label className="block text-sm text-cordly-secondary">Channel name
              <input required minLength={1} maxLength={80} autoFocus value={channelName} onChange={(event) => setChannelName(event.target.value)} className={inputClass} placeholder="project-chat" />
            </label>
            {categories.length > 0 && <label className="block text-sm text-cordly-secondary">Category
              <select value={selectedCategoryId} onChange={(event) => setSelectedCategoryId(event.target.value)} className={inputClass}>
                <option value="">No category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>}
            <button type="submit" className={buttonClass}>Create channel</button>
          </form>
        </Modal>
      )}
      {communityModal === 'category' && (
        <Modal open onClose={() => setCommunityModal(null)} title="Create a category">
          <form onSubmit={createCategory} className="space-y-4">
            <label className="block text-sm text-cordly-secondary">Category name
              <input required maxLength={64} autoFocus value={categoryName} onChange={(event) => setCategoryName(event.target.value)} className={inputClass} placeholder="Projects" />
            </label>
            <button type="submit" className={buttonClass}>Create category</button>
          </form>
        </Modal>
      )}
      {communityModal === 'settings' && activeGuild && (
        <div className="cordly-overlay-enter fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCommunityModal(null);
        }}>
          <section role="dialog" aria-modal="true" aria-label="Community settings" className="flex h-[min(820px,calc(100dvh-32px))] w-full max-w-6xl overflow-hidden rounded-modal border border-cordly-border bg-cordly-bg">
            <aside className="flex w-[240px] shrink-0 flex-col border-r border-cordly-border bg-cordly-surface max-sm:w-[168px]">
              <div className="border-b border-cordly-border px-4 py-5">
                <h2 className="truncate text-sm font-semibold" title={activeGuild.name}>{activeGuild.name}</h2>
              </div>
              <nav aria-label="Community settings pages" className="flex-1 overflow-y-auto p-2">
                {([
                  { label: 'Overview', id: 'overview', icon: Settings },
                  { label: 'Roles', id: 'roles', icon: Shield },
                  { label: 'Moderation', id: 'moderation', icon: Shield },
                  { label: 'Activity log', id: 'activity', icon: Activity },
                  { label: 'Expressions', id: 'expressions', icon: Smile, heading: true },
                  { label: 'Emoji', id: 'emoji', icon: Smile },
                  { label: 'Stickers', id: 'stickers', icon: Sticker },
                  { label: 'Community', id: 'community', icon: Compass, heading: true },
                  { label: 'Discovery', id: 'discovery', icon: Compass },
                  { label: 'Integrations', id: 'integrations', icon: Webhook, heading: true },
                  { label: 'Webhooks', id: 'webhooks', icon: Webhook },
                  { label: 'People', id: 'people', icon: Users, heading: true },
                  { label: 'Members', id: 'members', icon: Users },
                  { label: 'Invites', id: 'invites', icon: UserPlus },
                  { label: 'Bans', id: 'bans', icon: Ban },
                ] as const).map((item) => {
                  if ('heading' in item) return <p key={item.id} className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-cordly-muted">{item.label}</p>;
                  const selected = communitySettingsPage === item.id;
                  return <button key={item.id} type="button" aria-current={selected ? 'page' : undefined} onClick={() => setCommunitySettingsPage(item.id as CommunitySettingsPage)} className={`mb-0.5 flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-xs font-medium ${selected ? 'bg-cordly-active text-cordly-text' : 'text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text'}`}><item.icon size={15} /><span className="truncate">{item.label}</span></button>;
                })}
              </nav>
              <div className="border-t border-cordly-border p-2">
                <button type="button" disabled title="Community deletion is not available yet" className="flex w-full cursor-not-allowed items-center gap-2 rounded-control px-2.5 py-2 text-left text-xs font-medium text-cordly-danger opacity-70"><Trash2 size={15} />Delete community</button>
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex h-12 shrink-0 items-center justify-between border-b border-cordly-border px-5">
                <h2 className="text-sm font-semibold">{communitySettingsPage === 'activity' ? 'Activity log' : communitySettingsPage[0].toUpperCase() + communitySettingsPage.slice(1)}</h2>
                <button type="button" onClick={() => setCommunityModal(null)} aria-label="Close community settings" className="rounded-control p-1.5 text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text"><X size={17} /></button>
              </header>
              {communitySettingsPage === 'overview' ? (
                <form onSubmit={saveCommunitySettings} className="flex-1 overflow-y-auto">
                  <div className="mx-auto max-w-3xl space-y-7 px-6 py-6 sm:px-10">
                    {error && <p role="alert" className="rounded-control border border-cordly-danger/30 bg-cordly-danger/10 px-3 py-2 text-xs">{error}</p>}
                    <section>
                      <h3 className="mb-4 text-xs font-semibold">Branding</h3>
                      <div className="space-y-4">
                        <div>
                          <p className="mb-2 text-[11px] font-medium text-cordly-secondary">Icon</p>
                          <div className="flex items-center gap-3">
                            <div aria-label={`${activeGuild.name} icon`} className="flex h-14 w-14 items-center justify-center rounded-full bg-cordly-elevated text-sm font-semibold text-cordly-secondary">{initials(activeGuild.name)}</div>
                            <p className="text-xs text-cordly-muted">Community icon uploads are not available yet.</p>
                          </div>
                        </div>
                        <label className="block text-[11px] font-medium text-cordly-secondary">Name
                          <input required minLength={2} maxLength={80} value={communityNameDraft} onChange={(event) => setCommunityNameDraft(event.target.value)} className={`${inputClass} mt-2`} />
                        </label>
                        <div className="flex items-start justify-between gap-5">
                          <div><p className="text-[11px] font-medium">Detached banner</p><p className="mt-1 max-w-md text-[11px] leading-5 text-cordly-muted">Shows the banner in its own section below the community header.</p></div>
                          <button type="button" role="switch" aria-checked={detachedBannerDraft} aria-label="Detached banner" onClick={() => setDetachedBannerDraft((value) => !value)} className={`relative mt-1 h-5 w-9 shrink-0 rounded-full transition-colors ${detachedBannerDraft ? 'bg-cordly-accent' : 'bg-cordly-muted'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${detachedBannerDraft ? 'translate-x-[18px]' : 'translate-x-0.5'}`} /></button>
                        </div>
                      </div>
                    </section>
                    <section className="grid gap-5 sm:grid-cols-2">
                      <div><p className="mb-2 text-[11px] font-medium">Banner</p><div className="flex h-16 items-center justify-center rounded-control border border-cordly-border bg-cordly-elevated text-xs text-cordly-muted">No community banner</div></div>
                      <div><p className="mb-2 text-[11px] font-medium">Invite background</p><div className="flex h-16 items-center justify-center rounded-control border border-cordly-border bg-cordly-elevated text-xs text-cordly-muted">No invite background</div></div>
                    </section>
                    <section className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <h3 className="mb-3 text-[11px] font-semibold">Preview</h3>
                        <div className="inline-flex gap-2">
                          <button type="button" onClick={() => void createCommunityInvite()} className="rounded-control border border-cordly-border px-3 py-2 text-[11px] hover:bg-cordly-hover"><Users size={13} className="mr-1 inline" />Create invite</button>
                          <button type="button" onClick={() => { setCommunityModal('invite'); setCreatedInvite(''); }} className="rounded-control border border-cordly-border px-3 py-2 text-[11px] hover:bg-cordly-hover"><UserPlus size={13} className="mr-1 inline" />Invite options</button>
                        </div>
                        {createdInvite && <div className="mt-2 flex gap-2"><input readOnly aria-label="Created invite link" value={`${window.location.origin}/?invite=${createdInvite}`} className={`${inputClass} mt-0 min-w-0 text-xs`} /><button type="button" onClick={() => void copyCreatedInvite()} aria-label="Copy invite" className="rounded-control border border-cordly-border px-3 hover:bg-cordly-hover"><Copy size={14} /></button></div>}
                        <p className="mt-2 text-[10px] text-cordly-muted">Create an invite to preview the link members will use.</p>
                      </div>
                      <div>
                        <h3 className="mb-3 text-[11px] font-semibold">Chat embed background</h3>
                        <div className="rounded-card border border-cordly-border p-3">
                          <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-cordly-elevated text-[10px] font-semibold">{initials(activeGuild.name)}</span><div className="min-w-0"><p className="truncate text-xs font-semibold">{activeGuild.name}</p><p className="text-[10px] text-cordly-muted">{members.filter((member) => member.status === 'online').length} online · {members.length} members</p></div></div>
                          <div className="mt-3 border-t border-cordly-border pt-2 text-center text-[10px] text-cordly-muted">Community preview</div>
                        </div>
                      </div>
                    </section>
                    <div className="flex items-center justify-end gap-3 border-t border-cordly-border pt-4">
                      <button type="button" onClick={() => { setCommunityNameDraft(activeGuild.name); setDetachedBannerDraft(activeGuild.detachedBanner ?? false); }} className="rounded-control px-3 py-2 text-xs text-cordly-secondary hover:bg-cordly-hover">Reset</button>
                      <button type="submit" disabled={communitySettingsSaving || communityNameDraft.trim().length < 2} className={buttonClass}>{communitySettingsSaving ? 'Saving…' : 'Save changes'}</button>
                    </div>
                  </div>
                </form>
              ) : communitySettingsPage === 'members' ? (
                <div className="flex-1 overflow-y-auto p-5">
                  <h3 className="mb-4 text-sm font-semibold">Members · {members.length}</h3>
                  <div className="divide-y divide-cordly-border">{members.map((member) => <div key={member.id} className="flex items-center gap-3 py-3"><UserAvatar username={member.username} avatarUrl={member.avatarUrl} sizeClass="h-9 w-9 text-xs" status={member.status} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{member.displayName || member.username}</p><p className="text-[10px] text-cordly-muted">{member.username}#{member.tag}</p></div><span className="text-[10px] capitalize text-cordly-muted">{member.role}</span></div>)}</div>
                </div>
              ) : communitySettingsPage === 'invites' ? (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                  <UserPlus size={24} className="text-cordly-muted" />
                  <h3 className="mt-3 text-sm font-semibold">Invite people to {activeGuild.name}</h3>
                  <p className="mt-2 max-w-sm text-xs leading-5 text-cordly-secondary">Create a secure invite link with an expiry and use limit.</p>
                  <button type="button" onClick={() => { setCommunityModal('invite'); setCreatedInvite(''); }} className={`${buttonClass} mt-4`}>Create invite</button>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                  <h3 className="text-sm font-semibold">{communitySettingsPage[0].toUpperCase() + communitySettingsPage.slice(1)}</h3>
                  <p className="mt-2 max-w-sm text-xs leading-5 text-cordly-secondary">There are no {communitySettingsPage === 'roles' ? 'additional roles' : communitySettingsPage === 'bans' ? 'banned members' : `${communitySettingsPage} settings`} configured for this community yet.</p>
                  {communitySettingsPage === 'roles' && <p className="mt-1 text-[11px] text-cordly-muted">Owner and member roles are managed automatically.</p>}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {communityModal === 'notifications' && activeGuild && (
        <Modal open onClose={() => setCommunityModal(null)} title="Notification settings">
          <div className="space-y-4">
            <label className="block text-sm text-cordly-secondary">Community notifications
              <select value={String(communityPreferences.notificationLevel ?? 'all')} onChange={(event) => void saveCommunityPreferences({ notificationLevel: event.target.value })} className={inputClass}>
                <option value="all">All messages</option><option value="mentions">Only mentions</option><option value="nothing">Nothing</option>
              </select>
            </label>
            {([
              ['suppressEveryone', 'Suppress @everyone mentions'],
              ['suppressRoles', 'Suppress role mentions'],
            ] as const).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-3 text-sm text-cordly-secondary">{label}<input type="checkbox" checked={Boolean(communityPreferences[key])} onChange={(event) => void saveCommunityPreferences({ [key]: event.target.checked })} className="h-4 w-4 accent-cordly-accent" /></label>)}
            <label className="block text-sm text-cordly-secondary">Mute community
              <select value={communityPreferences.muteUntil ? '1' : '0'} onChange={(event) => void saveCommunityPreferences({ muteHours: Number(event.target.value) })} className={inputClass}>
                <option value="0">Not muted</option><option value="1">1 hour</option><option value="8">8 hours</option><option value="24">24 hours</option><option value="168">1 week</option>
              </select>
            </label>
          </div>
        </Modal>
      )}
      {communityModal === 'privacy' && activeGuild && (
        <Modal open onClose={() => setCommunityModal(null)} title="Community privacy">
          <div className="space-y-4">
            {([
              ['allowMemberDms', 'Allow direct messages from community members'],
              ['showActivity', 'Show my activity and status in this community'],
            ] as const).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-3 text-sm text-cordly-secondary">{label}<input type="checkbox" checked={communityPreferences[key] !== false} onChange={(event) => void saveCommunityPreferences({ [key]: event.target.checked })} className="h-4 w-4 accent-cordly-accent" /></label>)}
          </div>
        </Modal>
      )}
      {communityModal === 'profile' && activeGuild && (
        <Modal open onClose={() => setCommunityModal(null)} title="Community profile">
          <form onSubmit={(event) => { event.preventDefault(); void saveCommunityPreferences({ nickname: communityProfile.nickname, bio: communityProfile.bio }).then(() => setCommunityModal(null)); }} className="space-y-4">
            <p className="text-sm text-cordly-secondary">These details are shown only in {activeGuild.name}.</p>
            <label className="block text-sm text-cordly-secondary">Community nickname<input maxLength={32} value={communityProfile.nickname} onChange={(event) => setCommunityProfile((current) => ({ ...current, nickname: event.target.value }))} className={inputClass} placeholder={account.username} /></label>
            <label className="block text-sm text-cordly-secondary">Community bio<textarea maxLength={190} value={communityProfile.bio} onChange={(event) => setCommunityProfile((current) => ({ ...current, bio: event.target.value }))} className={inputClass} rows={3} /></label>
            <button type="submit" className={buttonClass}>Save community profile</button>
          </form>
        </Modal>
      )}
      {communityModal === 'leave' && activeGuild && (
        <Modal open onClose={() => setCommunityModal(null)} title={`Leave ${activeGuild.name}?`}>
          <p className="text-sm leading-6 text-cordly-secondary">You will need a new invite to join this community again.</p>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCommunityModal(null)} className="rounded-control px-4 py-2 text-sm hover:bg-cordly-hover">Cancel</button><button type="button" onClick={() => void leaveCommunity()} className="rounded-control bg-cordly-danger px-4 py-2 text-sm font-semibold text-white">Leave community</button></div>
        </Modal>
      )}
      {contextMenu && account && (
        <div
          ref={contextMenuRef}
          role="menu"
          aria-label={contextMenu.kind === 'message' ? 'Message options' : contextMenu.kind === 'self' ? 'Your quick options' : `${contextMenu.user.username} options`}
          onKeyDown={(event) => {
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              items[(index + direction + items.length) % items.length]?.focus();
            } else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
            }
          }}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-[110] max-h-[min(80vh,32rem)] w-60 overflow-y-auto rounded-card border border-cordly-border bg-cordly-surface p-1.5 shadow-2xl"
        >
          {contextMenu.kind === 'message' ? (
            <>
              {!contextMenu.direct && <div className="grid grid-cols-5 gap-1 border-b border-cordly-border p-1" aria-label="Quick reactions">
                {(['👍', '❤️', '😂', '🎉', '👀'] as const).map((emoji) => <MenuItem key={emoji} aria-label={`React with ${emoji}`} className="justify-center px-1.5" onClick={() => { setContextMenu(null); void actOnMessage(contextMenu.message, 'react', emoji); }}>{emoji}</MenuItem>)}
              </div>}
              {!contextMenu.direct && <MenuItem icon={<Reply size={15} />} onClick={() => { setReplyTarget(contextMenu.message); setEditingMessage(null); setContextMenu(null); }}>Reply</MenuItem>}
              {!contextMenu.direct && contextMenu.message.author.id === account.id && <MenuItem icon={<Pencil size={15} />} onClick={() => { setContextMenu(null); void actOnMessage(contextMenu.message, 'edit'); }}>Edit message</MenuItem>}
              {!contextMenu.direct && canManageMembers && <MenuItem icon={<Pin size={15} />} onClick={() => { setContextMenu(null); void actOnMessage(contextMenu.message, 'pin'); }}>{contextMenu.message.pinned ? 'Unpin message' : 'Pin message'}</MenuItem>}
              {contextMenu.message.content && <MenuItem icon={<Copy size={15} />} onClick={() => { setContextMenu(null); copyContextValue(contextMenu.message.content, 'Message copied.'); }}>Copy message text</MenuItem>}
              {!contextMenu.direct && <MenuItem icon={<LinkIcon size={15} />} onClick={() => {
                const url = new URL(window.location.href);
                if (activeChannel) url.searchParams.set('channel', activeChannel.id);
                url.searchParams.set('message', contextMenu.message.id);
                setContextMenu(null);
                copyContextValue(url.toString(), 'Message link copied.');
              }}>Copy message link</MenuItem>}
              {!contextMenu.direct && <MenuItem icon={<Flag size={15} />} onClick={() => { setContextMenu(null); void actOnMessage(contextMenu.message, 'report'); }}>Report message</MenuItem>}
              {!contextMenu.direct && (contextMenu.message.author.id === account.id || canManageMembers) && <MenuItem danger icon={<Trash2 size={15} />} onClick={() => { setContextMenu(null); void actOnMessage(contextMenu.message, 'delete'); }}>Delete message</MenuItem>}
              {preferences?.developerMode && <MenuItem icon={<Copy size={15} />} onClick={() => { setContextMenu(null); copyContextValue(contextMenu.message.id, 'Message ID copied.'); }}>Copy message ID</MenuItem>}
            </>
          ) : contextMenu.kind === 'self' ? (
            <>
              <MenuItem icon={<Users size={15} />} onClick={() => { setContextMenu(null); void openUserProfile(account.id); }}>View profile</MenuItem>
              {(activeChannel || activeDm) && <MenuItem icon={<MessageSquare size={15} />} onClick={() => { setContextMenu(null); setMessageDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${account.username} `); }}>Mention</MenuItem>}
              <MenuItem icon={<Pencil size={15} />} onClick={() => { setContextMenu(null); if (workspace === 'servers' && activeGuild) setCommunityModal('profile'); else openSettings(); }}>Edit profile{workspace === 'servers' && activeGuild ? ' / community nickname' : ''}</MenuItem>
              <MenuItem icon={<Copy size={15} />} onClick={() => { setContextMenu(null); void copyAccountId(); }}>Copy user ID</MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon={<Users size={15} />} onClick={() => { setContextMenu(null); void openUserProfile(contextMenu.user.id); }}>View profile</MenuItem>
              {friends.some((relation) => relation.user.id === contextMenu.user.id && relation.status === 'accepted') && <MenuItem icon={<MessageSquare size={15} />} onClick={() => {
                const relation = friends.find((item) => item.user.id === contextMenu.user.id);
                setContextMenu(null);
                if (relation) void openDirectMessage(relation.user);
              }}>Message</MenuItem>}
              {!friends.some((relation) => relation.user.id === contextMenu.user.id) && <MenuItem icon={<UserPlus size={15} />} onClick={() => { setContextMenu(null); void addFriendFromContext(contextMenu.user); }}>Add friend</MenuItem>}
              {friends.find((relation) => relation.user.id === contextMenu.user.id) && <MenuItem danger icon={<Ban size={15} />} onClick={() => {
                const relation = friends.find((item) => item.user.id === contextMenu.user.id);
                setContextMenu(null);
                if (relation && window.confirm(`Block ${contextMenu.user.username}?`)) void answerFriendRequest(relation.id, 'block');
              }}>Block user</MenuItem>}
              {preferences?.developerMode && <MenuItem icon={<Copy size={15} />} onClick={() => { setContextMenu(null); copyContextValue(contextMenu.user.id, 'User ID copied.'); }}>Copy user ID</MenuItem>}
            </>
          )}
        </div>
      )}
      {profileDialogOpen && (
        <div className={`${memberProfileFull ? 'cordly-overlay-enter fixed inset-0 z-[80] bg-cordly-bg' : 'cordly-overlay-enter pointer-events-none fixed inset-0 z-[80]'}`}>
          {memberProfileLoading || !memberProfile ? (
            <section ref={profileDialogRef} role="dialog" aria-modal={memberProfileFull || undefined} aria-label="Loading profile" className={`${memberProfileFull ? 'pointer-events-auto absolute inset-0 flex items-center justify-center bg-cordly-bg' : 'pointer-events-auto absolute right-4 top-4 flex max-h-[calc(100dvh-2rem)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-y-auto rounded-card border border-cordly-accent/70 bg-cordly-bg p-8 text-center text-sm text-cordly-secondary shadow-2xl md:right-72'}`}>Loading profile…</section>
          ) : (
            <section ref={profileDialogRef} role="dialog" aria-modal={memberProfileFull || undefined} aria-label={`${memberProfile.displayName}'s profile`} className={`${memberProfileFull ? 'pointer-events-auto absolute inset-0 flex h-dvh w-full flex-col overflow-hidden bg-cordly-bg' : 'pointer-events-auto absolute right-4 top-4 flex max-h-[calc(100dvh-2rem)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-cordly-accent/70 bg-cordly-bg shadow-2xl'}`}>
              <button ref={profileCloseButtonRef} type="button" onClick={closeUserProfile} aria-label="Close profile" className="absolute right-3 top-3 z-10 rounded-control bg-black/50 p-2 text-white/80 hover:bg-black/75 hover:text-white"><X size={16} /></button>
              <div className={`${memberProfileFull ? 'h-56 sm:h-64' : 'h-32'} shrink-0 bg-cordly-elevated bg-cover bg-center`} style={memberProfile.bannerUrl ? { backgroundImage: `url("${memberProfile.bannerUrl}")` } : undefined} />
              <div className={`-mt-12 flex items-end justify-between gap-3 px-4 ${memberProfileFull ? 'sm:px-8' : ''}`}>
                <div className="rounded-full border-4 border-cordly-bg"><UserAvatar username={memberProfile.displayName || memberProfile.username} avatarUrl={memberProfile.avatarUrl} sizeClass={memberProfileFull ? 'h-24 w-24 text-2xl' : 'h-20 w-20 text-xl'} status={memberProfile.status} /></div>
                <div className="mb-1 flex items-center gap-2">
                  {!memberProfile.isFriend && !memberProfile.friendRequestPending && memberProfile.id !== account.id && <button type="button" onClick={() => void sendProfileFriendRequest()} title="Add friend" aria-label="Add friend" className="rounded-control border border-cordly-border bg-cordly-surface p-2 text-cordly-secondary hover:bg-cordly-hover"><UserPlus size={16} /></button>}
                  {memberProfile.friendRequestPending && memberProfile.canAcceptFriendRequest && <button type="button" onClick={() => void sendProfileFriendRequest()} className="rounded-control border border-cordly-border bg-cordly-surface px-3 py-2 text-xs hover:bg-cordly-hover">Accept request</button>}
                  {memberProfile.friendRequestPending && !memberProfile.canAcceptFriendRequest && <span className="rounded-control border border-cordly-border bg-cordly-surface px-2.5 py-2 text-[11px] text-cordly-muted">Request sent</span>}
                  {memberProfile.isFriend && <span className="rounded-control border border-cordly-border bg-cordly-surface px-2.5 py-2 text-[11px] text-cordly-secondary">Friend</span>}
                </div>
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3 ${memberProfileFull ? 'sm:px-8' : ''}`}>
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold">{memberProfile.displayName || memberProfile.username}</h2>
                    {memberProfile.community?.role === 'owner' && <Crown size={15} className="text-cordly-warning" aria-label="Community owner" />}
                  </div>
                  <p className="text-xs text-cordly-secondary">{memberProfile.username}#{memberProfile.tag}</p>
                  {memberProfile.pronouns && <p className="mt-1 text-xs text-cordly-secondary">{memberProfile.pronouns}</p>}
                  <p className="mt-1 text-[11px] capitalize text-cordly-muted">{memberProfile.status.replace('dnd', 'do not disturb')}</p>
                </div>
                {memberProfileFull && (
                  <nav aria-label="Profile sections" className="mb-4 flex gap-5 border-b border-cordly-border">
                    {([
                      ['overview', 'Overview'],
                      ['friends', `Mutual friends (${memberProfile.mutualFriends.length})`],
                      ['communities', `Mutual communities (${memberProfile.mutualCommunities.length})`],
                    ] as const).map(([tab, label]) => <button key={tab} type="button" onClick={() => setMemberProfileTab(tab)} className={`border-b-2 px-1 pb-2 text-xs font-semibold ${memberProfileTab === tab ? 'border-cordly-accent text-cordly-text' : 'border-transparent text-cordly-secondary hover:text-cordly-text'}`}>{label}</button>)}
                  </nav>
                )}
                {(!memberProfileFull || memberProfileTab === 'overview') ? (
                  <div className="space-y-4">
                    {memberProfile.bio && <p className="whitespace-pre-wrap break-words text-sm leading-6">{memberProfile.bio}</p>}
                    {memberProfile.timezoneOffset && <section><h3 className="text-xs font-semibold">Local time</h3><p className="mt-1 text-xs text-cordly-secondary">{profileLocalTime(memberProfile.timezoneOffset)}</p></section>}
                    <section>
                      <h3 className="text-xs font-semibold">{memberProfile.community ? 'Member since' : 'Cordly member since'}</h3>
                      <p className="mt-1 text-xs text-cordly-secondary">{new Date(memberProfile.community?.joinedAt ?? memberProfile.accountCreatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                    </section>
                    {memberProfile.community && <section><h3 className="text-xs font-semibold">Roles in {memberProfile.community.name}</h3><div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded border border-cordly-border px-2 py-1 text-[11px] capitalize">{memberProfile.community.role === 'owner' ? 'Community owner' : 'Member'}</span></div></section>}
                    {memberProfile.platformRole !== 'none' && <section><h3 className="text-xs font-semibold">Cordly team</h3><span className="mt-2 inline-block rounded border border-cordly-border px-2 py-1 text-[11px] capitalize">{memberProfile.platformRole}</span></section>}
                    {!memberProfile.community && !memberProfile.bio && <p className="text-xs text-cordly-muted">This profile has no additional details.</p>}
                  </div>
                ) : memberProfileTab === 'friends' ? (
                  memberProfile.mutualFriends.length ? <div className="space-y-1">{memberProfile.mutualFriends.map((friend) => <button key={friend.id} type="button" onClick={() => void openUserProfile(friend.id, true)} className="flex w-full items-center gap-3 rounded-control p-2 text-left hover:bg-cordly-hover"><UserAvatar username={friend.username} avatarUrl={friend.avatarUrl} sizeClass="h-9 w-9 text-xs" /><span className="text-xs font-medium">{friend.username}<span className="ml-1 text-cordly-muted">#{friend.tag}</span></span></button>)}</div> : <p className="py-8 text-center text-xs text-cordly-muted">No mutual friends.</p>
                ) : memberProfile.mutualCommunities.length ? (
                  <div className="space-y-1">{memberProfile.mutualCommunities.map((community) => <div key={community.id} className="flex items-center gap-3 rounded-control p-2"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-cordly-elevated text-xs font-semibold">{initials(community.name)}</span><span className="text-xs font-medium">{community.name}</span></div>)}</div>
                ) : <p className="py-8 text-center text-xs text-cordly-muted">No mutual communities.</p>}
                <div className="mt-5 border-t border-cordly-border pt-4">
                  <button type="button" onClick={() => setMemberProfileFull((value) => !value)} className="w-full rounded-control bg-cordly-accent px-4 py-2.5 text-xs font-semibold text-white hover:bg-cordly-accent-hover">{memberProfileFull ? 'Back to profile card' : 'View full profile'}</button>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
      {serverDialogOpen && (
        <div
          className="cordly-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setServerDialogOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-dialog-title"
            className="relative flex max-h-[min(620px,calc(100dvh-32px))] w-full max-w-[460px] flex-col overflow-hidden rounded-modal border border-cordly-border bg-cordly-surface"
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setServerDialogOpen(false)}
              className="absolute right-4 top-4 z-10 rounded p-1 text-2xl leading-none text-cordly-secondary hover:text-cordly-text"
            >
              ×
            </button>
            <div className="overflow-y-auto px-6 pb-5 pt-5 sm:px-7">
              {serverDialogView === 'choose' ? (
                <>
                  <h2 id="community-dialog-title" className="text-center text-xl font-bold tracking-tight">Communities</h2>
                  <p className="mx-auto mt-2 max-w-sm text-center text-sm leading-5 text-cordly-secondary">
                    Create a community or join one with an invite link.
                  </p>
                  {error && <p role="alert" className="mt-4 rounded-control bg-cordly-danger/10 px-3 py-2 text-sm text-cordly-text">{error}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setServerDialogView('create');
                    }}
                    className="mt-8 flex w-full items-center justify-between rounded-card border border-cordly-border bg-cordly-elevated px-4 py-4 text-left text-sm font-medium transition hover:bg-cordly-hover"
                  >
                    <span className="flex items-center gap-3"><span className="text-lg">+</span>Create a community</span>
                    <span className="text-xl text-cordly-muted">›</span>
                  </button>
                  <div className="mt-6 border-t border-cordly-border pt-4">
                    <h3 className="text-center text-base font-semibold">Have an invite already?</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setError('');
                        setServerDialogView('join');
                      }}
                      className="mt-3 w-full rounded-card border border-cordly-border bg-cordly-elevated px-4 py-3 text-sm font-medium text-cordly-text transition hover:bg-cordly-hover"
                    >
                      Join a community
                    </button>
                  </div>
                </>
              ) : serverDialogView === 'create' ? (
                <>
                  <button type="button" onClick={() => setServerDialogView('choose')} className="mb-4 text-xs text-cordly-secondary hover:text-cordly-text">← Back</button>
                  <h2 id="community-dialog-title" className="text-center text-xl font-bold">Name your community</h2>
                  <p className="mt-2 text-center text-sm text-cordly-secondary">You can always change this later.</p>
                  {error && <p role="alert" className="mt-4 rounded-control bg-cordly-danger/10 px-3 py-2 text-sm text-cordly-text">{error}</p>}
                  <form onSubmit={createServer} className="mt-6 space-y-4">
                    <label htmlFor="create-server-name" className="block text-xs font-semibold uppercase tracking-wide text-cordly-secondary">
                      Community name
                      <input
                        id="create-server-name"
                        required
                        minLength={2}
                        maxLength={80}
                        autoFocus
                        value={guildName}
                        onChange={(event) => setGuildName(event.target.value)}
                        className={inputClass}
                        placeholder="My community"
                      />
                    </label>
                    <button type="submit" className={buttonClass}>Create community</button>
                  </form>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setServerDialogView('choose')} className="mb-4 text-xs text-cordly-secondary hover:text-cordly-text">← Back</button>
                  <h2 id="community-dialog-title" className="text-center text-xl font-bold">Join a community</h2>
                  <p className="mt-2 text-center text-sm text-cordly-secondary">Enter an invite code to join a community.</p>
                  {error && <p role="alert" className="mt-4 rounded-control bg-cordly-danger/10 px-3 py-2 text-sm text-cordly-text">{error}</p>}
                  <form onSubmit={joinServer} className="mt-6 space-y-4">
                    <label htmlFor="join-server-code" className="block text-xs font-semibold uppercase tracking-wide text-cordly-secondary">
                      Invite code
                      <input
                        id="join-server-code"
                        required
                        autoFocus
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                        className={inputClass}
                        placeholder="Paste an invite code"
                      />
                    </label>
                    <button type="submit" className={buttonClass}>Join community</button>
                  </form>
                </>
              )}
            </div>
          </section>
        </div>
      )}
      {settingsOpen && (
        <div className="cordly-overlay-enter fixed inset-0 z-[60] flex bg-black/80 text-cordly-text">
          <section role="dialog" aria-modal="true" aria-label="User settings" className="m-auto flex h-full w-full max-w-6xl overflow-hidden border border-cordly-border bg-cordly-bg md:h-[min(900px,calc(100dvh-48px))] md:rounded-modal">
            <aside className="flex w-[280px] shrink-0 flex-col border-r border-cordly-border bg-cordly-surface max-md:w-[220px] max-[600px]:hidden">
              <div className="border-b border-cordly-border p-4">
                <label className="relative block"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-cordly-muted" /><input ref={settingsSearchRef} value={settingsSearch} onChange={(event) => setSettingsSearch(event.target.value)} placeholder="Search settings" aria-label="Search settings" className="w-full rounded-control border border-cordly-border bg-cordly-elevated py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-cordly" /></label>
                <button type="button" onClick={() => openSettingsPage('profile')} className="mt-3 flex w-full items-center gap-3 rounded-card p-2 text-left hover:bg-cordly-hover"><UserAvatar username={profileSettings?.displayName || account.username} avatarUrl={account.avatarUrl} sizeClass="h-9 w-9 text-xs" status={account.status} /><span className="min-w-0"><span className="block truncate text-xs font-semibold">{profileSettings?.displayName || account.username}</span><span className="block truncate text-[10px] text-cordly-muted">{account.username}#{account.tag}</span></span></button>
              </div>
              <nav aria-label="Settings pages" className="flex-1 overflow-y-auto px-2 py-3">
                {(['Your account', 'App settings', 'Developer'] as const).map((section) => {
                  const pages = searchSettings(settingsSearch).filter((page) => page.section === section);
                  if (!pages.length) return null;
                  return <div key={section} className="mb-4"><h2 className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-cordly-muted">{section}</h2>{pages.map((page) => <button key={page.id} type="button" onClick={() => openSettingsPage(page.id)} className={`mb-0.5 w-full rounded-control px-2.5 py-2 text-left text-sm ${settingsPage === page.id ? 'bg-cordly-active text-cordly-text' : 'text-cordly-secondary hover:bg-cordly-hover hover:text-cordly-text'}`}>{page.label}</button>)}</div>;
                })}
                {settingsSearch && searchSettings(settingsSearch).length === 0 && <p className="px-3 py-4 text-xs text-cordly-muted">No matching settings.</p>}
              </nav>
              <button type="button" onClick={() => void logout()} className="border-t border-cordly-border px-4 py-3 text-left text-sm text-cordly-danger hover:bg-cordly-hover">Sign out</button>
              <p className="px-4 pb-3 text-[10px] leading-4 text-cordly-muted">Cordly · {process.env.NEXT_PUBLIC_APP_VERSION ?? 'Community chat'}<br /><a href="/terms" className="underline">Terms</a> · <a href="/privacy" className="underline">Privacy</a></p>
            </aside>
            <form onSubmit={saveSettings} className="relative flex min-w-0 flex-1 flex-col">
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-cordly-border px-5">
                <div><h1 className="text-base font-semibold">{SETTINGS_REGISTRY.find((page) => page.id === settingsPage)?.label ?? 'Settings'}</h1><p className="text-[10px] text-cordly-muted">Personalize your Cordly experience</p></div>
                <div className="flex items-center gap-2">
                  <button type="button" title="Copy settings link" aria-label="Copy settings link" onClick={() => void navigator.clipboard.writeText(window.location.href)} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><Copy size={16} /></button>
                  <button type="button" title="Close settings" aria-label="Close settings" onClick={closeSettings} className="rounded-control p-2 text-cordly-secondary hover:bg-cordly-hover"><X size={18} /></button>
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-8">
                {settingsError && <p role="alert" className="mb-4 rounded-control border border-cordly-danger/30 bg-cordly-danger/10 px-3 py-2 text-sm">{settingsError}</p>}
                {settingsLoading || !preferences || !profileSettings ? <p role="status" className="py-12 text-center text-sm text-cordly-muted">Loading your saved settings…</p> : (
                  <>
                    {settingsPage === 'profile' && <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                      <div className="space-y-5">
                        <div><h2 className="text-lg font-semibold">Profile customization</h2><p className="mt-1 text-sm text-cordly-secondary">Edit your profile appearance and see a live preview.</p></div>
                        <FormField label="Profile type" htmlFor="profile-type" hint="Community-specific profile details are managed in that community's profile menu.">
                          <Select id="profile-type" value="global" onChange={() => undefined}><option value="global">Global profile</option>{guilds.map((guild) => <option key={guild.id} value={guild.id} disabled>{guild.name} (edit from community menu)</option>)}</Select>
                        </FormField>
                        <div className="rounded-card border border-cordly-border p-4">
                          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Username</h3><span className="text-xs text-cordly-muted">Changes: 2 per hour, 10 per day</span></div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_110px]">
                            <label className="text-xs text-cordly-secondary">Username<input required minLength={2} maxLength={32} value={settingsUsername} onChange={(event) => { setSettingsUsername(event.target.value.replace(/[^A-Za-z0-9_.-]/g, '')); setSettingsDirty(true); }} className={inputClass} /></label>
                            <label className="text-xs text-cordly-secondary">Tag<input required maxLength={4} pattern="[0-9]{4}" value={settingsTag} onChange={(event) => { setSettingsTag(event.target.value.replace(/\D/g, '').slice(0, 4)); setSettingsDirty(true); }} className={inputClass} /></label>
                          </div>
                        </div>
                        <FormField label="Display name" htmlFor="profile-display-name"><input id="profile-display-name" maxLength={32} value={profileSettings.displayName} onChange={(event) => updateProfile('displayName', event.target.value)} className={inputClass} /></FormField>
                        <FormField label="Pronouns" htmlFor="profile-pronouns"><input id="profile-pronouns" maxLength={40} value={profileSettings.pronouns} onChange={(event) => updateProfile('pronouns', event.target.value)} className={inputClass} /></FormField>
                        <FormField label="Bio / About me" htmlFor="profile-bio" hint={`${profileSettings.bio.length}/190`}>
                          <textarea id="profile-bio" maxLength={190} rows={4} value={profileSettings.bio} onChange={(event) => updateProfile('bio', event.target.value)} className={inputClass} />
                        </FormField>
                        <FormField label="Profile local time" htmlFor="profile-timezone" hint="Other people only see your current UTC offset; your time zone name stays private.">
                          <input id="profile-timezone" list="cordly-timezones" value={profileSettings.timezone} onChange={(event) => updateProfile('timezone', event.target.value)} className={inputClass} placeholder="Search IANA time zones" />
                          <datalist id="cordly-timezones">{(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo']).map((zone) => <option key={zone} value={zone} />)}</datalist>
                        </FormField>
                        <div className="space-y-3 rounded-card border border-cordly-border p-4">
                          <h3 className="text-sm font-semibold">Avatar</h3>
                          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} className="block w-full text-xs text-cordly-secondary file:mr-3 file:rounded-control file:border-0 file:bg-cordly-elevated file:px-3 file:py-2 file:text-xs file:text-cordly-text" />
                          <div className="flex gap-2"><button type="button" disabled={settingsSaving || !avatarFile} onClick={() => void saveAvatar()} className="rounded-control bg-cordly-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Change avatar</button>{account.avatarUrl && <button type="button" disabled={settingsSaving} onClick={() => void saveAvatar(true)} className="rounded-control px-3 py-2 text-xs text-cordly-danger hover:bg-cordly-hover">Remove avatar</button>}</div>
                        </div>
                        <div className="space-y-3 rounded-card border border-cordly-border p-4">
                          <h3 className="text-sm font-semibold">Profile banner</h3>
                          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setBannerFile(event.target.files?.[0] ?? null)} className="block w-full text-xs text-cordly-secondary file:mr-3 file:rounded-control file:border-0 file:bg-cordly-elevated file:px-3 file:py-2 file:text-xs file:text-cordly-text" />
                          <div className="flex gap-2"><button type="button" disabled={settingsSaving || !bannerFile} onClick={() => void saveBanner()} className="rounded-control bg-cordly-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Change banner</button>{account.bannerUrl && <button type="button" disabled={settingsSaving} onClick={() => void saveBanner(true)} className="rounded-control px-3 py-2 text-xs text-cordly-danger hover:bg-cordly-hover">Remove banner</button>}</div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2"><ColorInput label="Accent color" value={profileSettings.accentColor} onChange={(value) => updateProfile('accentColor', value)} /><ColorInput label="Primary profile color" value={profileSettings.primaryColor} onChange={(value) => updateProfile('primaryColor', value)} /><ColorInput label="Secondary profile color" value={profileSettings.secondaryColor} onChange={(value) => updateProfile('secondaryColor', value)} /></div>
                        <label className="block text-xs font-medium text-cordly-secondary">Status
                          <Select value={settingsStatus} onChange={(event) => { setSettingsStatus(event.target.value as Account['status']); setSettingsDirty(true); }}><option value="online">Online</option><option value="idle">Idle</option><option value="dnd">Do not disturb</option><option value="offline">Offline</option></Select>
                        </label>
                      </div>
                      <aside><h2 className="mb-3 text-sm font-semibold">Profile preview</h2><div className="overflow-hidden rounded-modal border border-cordly-border bg-cordly-surface">
                        <div className="h-28 bg-cover bg-center" style={{ backgroundColor: profileSettings.accentColor, ...(account.bannerUrl ? { backgroundImage: `url("${account.bannerUrl}")` } : {}) }} />
                        <div className="px-5 pb-5"><div className="-mt-9 flex items-end justify-between"><UserAvatar username={profileSettings.displayName || settingsUsername || account.username} avatarUrl={account.avatarUrl} sizeClass="h-[76px] w-[76px] border-4 border-cordly-surface text-lg" status={settingsStatus} /><button type="button" disabled className="rounded-control border border-cordly-border px-3 py-2 text-xs text-cordly-muted">Message</button></div>
                          <h3 className="mt-3 text-lg font-bold">{profileSettings.displayName || settingsUsername || account.username}</h3><p className="text-xs text-cordly-secondary">{settingsUsername}#{settingsTag}</p><p className="mt-2 text-xs text-cordly-muted">Cordly member · {new Date().getFullYear()}</p>{profileSettings.pronouns && <p className="mt-2 text-xs text-cordly-secondary">{profileSettings.pronouns}</p>}{profileSettings.bio && <p className="mt-3 whitespace-pre-wrap text-sm leading-5">{profileSettings.bio}</p>}
                        </div></div></aside>
                    </div>}
                    {settingsPage === 'account' && <div className="max-w-2xl space-y-6">
                      <div><h2 className="text-lg font-semibold">Account</h2><p className="mt-1 text-sm text-cordly-secondary">Sign-in security, sessions, and account data.</p></div>
                      <FormField label="Email address" htmlFor="account-email"><input id="account-email" value={account.email ?? ''} disabled className={inputClass} /></FormField>
                      <FormField label="Username" htmlFor="account-name"><input id="account-name" value={`${settingsUsername}#${settingsTag}`} disabled className={inputClass} /></FormField>
                      <p className="text-xs text-cordly-muted">Member since {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : '—'}.</p>
                      <section className="space-y-3 rounded-card border border-cordly-border p-4"><h3 className="text-sm font-semibold">Change password</h3>
                        <label className="block text-xs text-cordly-secondary">Current password<input type="password" autoComplete="current-password" value={passwordFields.current} onChange={(event) => setPasswordFields((current) => ({ ...current, current: event.target.value }))} className={inputClass} /></label>
                        <label className="block text-xs text-cordly-secondary">New password<input type="password" minLength={8} maxLength={128} autoComplete="new-password" value={passwordFields.next} onChange={(event) => setPasswordFields((current) => ({ ...current, next: event.target.value }))} className={inputClass} /></label>
                        <button type="button" onClick={() => void changePassword()} disabled={!passwordFields.current || passwordFields.next.length < 8} className={buttonClass}>Update password</button>
                      </section>
                      <section className="space-y-3 rounded-card border border-cordly-border p-4"><div><h3 className="text-sm font-semibold">Two-factor authentication</h3><p className="mt-1 text-xs text-cordly-secondary">{account.twoFactorEnabled ? 'Authenticator verification is required when signing in.' : 'Secure sign-in with a time-based authenticator app.'}</p></div>
                        {!account.twoFactorEnabled && !totpSetup && <button type="button" onClick={() => void startTotpSetup()} disabled={!passwordFields.current} className={buttonClass}>Set up authenticator</button>}
                        {totpSetup && <div className="space-y-3"><Image src={totpSetup.qrCode} alt="Authenticator setup QR code" width={192} height={192} unoptimized /><p className="text-xs text-cordly-secondary">Or enter this key manually: <code className="select-all break-all">{totpSetup.secret}</code></p><label className="block text-xs text-cordly-secondary">Authenticator code<input autoComplete="one-time-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} className={inputClass} /></label><button type="button" onClick={() => void updateTotp('enable')} className={buttonClass}>Enable two-factor authentication</button></div>}
                        {account.twoFactorEnabled && <div className="space-y-3"><label className="block text-xs text-cordly-secondary">Authenticator code to disable<input autoComplete="one-time-code" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} className={inputClass} /></label><button type="button" onClick={() => void updateTotp('disable')} className="rounded-control border border-cordly-danger px-3 py-2 text-xs text-cordly-danger hover:bg-cordly-danger/10">Disable two-factor authentication</button></div>}
                        {backupCodes.length > 0 && <div role="status" className="rounded-control border border-cordly-warning/30 bg-cordly-warning/10 p-3"><p className="mb-2 text-sm font-semibold">Save these backup codes now. They will not be shown again.</p><p className="grid grid-cols-2 gap-1 font-mono text-xs">{backupCodes.map((code) => <code key={code}>{code}</code>)}</p></div>}
                      </section>
                      <section className="space-y-3 rounded-card border border-cordly-border p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Active sessions</h3><button type="button" onClick={() => window.location.reload()} className="text-xs text-indigo-300 hover:underline">Refresh</button></div>
                        {activeSessions.length === 0 ? <p className="text-xs text-cordly-muted">No active sessions.</p> : activeSessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-3 border-t border-cordly-border py-2"><div className="min-w-0"><p className="truncate text-xs">{session.userAgent ?? 'Unknown device'}{session.current ? ' · This device' : ''}</p><p className="text-[10px] text-cordly-muted">Last active {session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString() : '—'}</p></div><button type="button" onClick={() => void revokeSession(session.id)} className="shrink-0 text-xs text-cordly-danger hover:underline">{session.current ? 'Sign out' : 'Revoke'}</button></div>)}
                      </section>
                      <section className="space-y-3 rounded-card border border-cordly-border p-4"><h3 className="text-sm font-semibold">Your data</h3><p className="text-xs text-cordly-secondary">Download account details, settings, community memberships, friend relationships, and your authored messages.</p><button type="button" onClick={() => void exportAccountData()} className="rounded-control border border-cordly-border px-3 py-2 text-xs hover:bg-cordly-hover">Download account data</button></section>
                      <section className="space-y-3 rounded-card border border-cordly-danger/30 p-4"><h3 className="text-sm font-semibold text-cordly-danger">Disable account</h3><p className="text-xs leading-5 text-cordly-secondary">This suspends sign-in and revokes every active session. Contact an administrator to restore access.</p><label className="block text-xs text-cordly-secondary">Confirm with your password<input type="password" autoComplete="current-password" value={deactivatePassword} onChange={(event) => setDeactivatePassword(event.target.value)} className={inputClass} /></label><button type="button" onClick={() => { if (window.confirm('Disable this account and revoke all sessions?')) void deactivateAccount(); }} disabled={!deactivatePassword} className="rounded-control bg-cordly-danger px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Disable account</button></section>
                    </div>}
                    {settingsPage === 'privacy' && <div className="max-w-2xl space-y-5"><div><h2 className="text-lg font-semibold">Privacy and safety</h2><p className="mt-1 text-sm text-cordly-secondary">Choose who can contact you and what activity is visible.</p></div><label className="block text-sm">Direct messages<Select value={preferences.privacy.directMessages} onChange={(event) => updatePreference('privacy', 'directMessages', event.target.value as AppPreferences['privacy']['directMessages'])}><option value="everyone">Everyone</option><option value="friends">Friends</option><option value="nobody">Nobody</option></Select></label><label className="block text-sm">Friend requests<Select value={preferences.privacy.friendRequests} onChange={(event) => updatePreference('privacy', 'friendRequests', event.target.value as AppPreferences['privacy']['friendRequests'])}><option value="everyone">Everyone</option><option value="mutuals">Mutual communities</option><option value="nobody">Nobody</option></Select></label><Toggle label="Filter explicit media" checked={preferences.privacy.explicitMediaFilter} onChange={(value) => updatePreference('privacy', 'explicitMediaFilter', value)} /><Toggle label="Show activity status" checked={preferences.privacy.showActivity} onChange={(value) => updatePreference('privacy', 'showActivity', value)} /><Toggle label="Read receipts" checked={preferences.privacy.readReceipts} onChange={(value) => updatePreference('privacy', 'readReceipts', value)} /></div>}
                    {settingsPage === 'appearance' && <div className="max-w-2xl space-y-6"><div><h2 className="text-lg font-semibold">Appearance</h2><p className="mt-1 text-sm text-cordly-secondary">Tune the app to your screen and reading preference.</p></div><label className="block text-sm">Theme<Select value={preferences.appearance.theme} onChange={(event) => updatePreference('appearance', 'theme', event.target.value as AppPreferences['appearance']['theme'])}><option value="oled">OLED</option><option value="dark">Dark</option><option value="light">Light</option><option value="system">Sync with system</option></Select></label><label className="block text-sm">Message layout<Select value={preferences.appearance.messageLayout} onChange={(event) => updatePreference('appearance', 'messageLayout', event.target.value as AppPreferences['appearance']['messageLayout'])}><option value="cozy">Cozy</option><option value="compact">Compact</option></Select></label><Slider label="Chat font size" min={12} max={20} value={preferences.appearance.fontSize} onChange={(value) => updatePreference('appearance', 'fontSize', value)} /><Slider label="Message group spacing" min={0} max={32} value={preferences.appearance.groupSpacing} onChange={(value) => updatePreference('appearance', 'groupSpacing', value)} /><Slider label="Interface zoom" min={80} max={120} value={preferences.appearance.zoom} onChange={(value) => updatePreference('appearance', 'zoom', value)} formatValue={(value) => `${value}%`} /><Slider label="Color saturation" value={preferences.appearance.saturation} onChange={(value) => updatePreference('appearance', 'saturation', value)} formatValue={(value) => `${value}%`} /><Toggle label="Show role colors in names" checked={preferences.appearance.roleColors} onChange={(value) => updatePreference('appearance', 'roleColors', value)} /></div>}
                    {settingsPage === 'notifications' && <div className="max-w-2xl space-y-5"><h2 className="text-lg font-semibold">Notifications</h2><Toggle label="Desktop notifications" checked={preferences.notifications.desktopPush} onChange={(value) => updatePreference('notifications', 'desktopPush', value)} /><Toggle label="Notification sounds" checked={preferences.notifications.sounds} onChange={(value) => updatePreference('notifications', 'sounds', value)} /><Slider label="Sound volume" value={preferences.notifications.soundVolume} onChange={(value) => updatePreference('notifications', 'soundVolume', value)} formatValue={(value) => `${value}%`} /><Toggle label="Unread badges" checked={preferences.notifications.unreadBadges} onChange={(value) => updatePreference('notifications', 'unreadBadges', value)} /><Toggle label="Quiet hours" checked={preferences.notifications.quietHours} onChange={(value) => updatePreference('notifications', 'quietHours', value)} /></div>}
                    {settingsPage === 'chat' && <div className="max-w-2xl space-y-5"><h2 className="text-lg font-semibold">Chat</h2><Toggle label="Link previews" checked={preferences.chat.linkPreviews} onChange={(value) => updatePreference('chat', 'linkPreviews', value)} /><Toggle label="Show inline attachments" checked={preferences.chat.inlineAttachments} onChange={(value) => updatePreference('chat', 'inlineAttachments', value)} /><Toggle label="Convert emoticons to emoji" checked={preferences.chat.convertEmoticons} onChange={(value) => updatePreference('chat', 'convertEmoticons', value)} /><Toggle label="Hide spoiler content" checked={preferences.chat.hideSpoilers} onChange={(value) => updatePreference('chat', 'hideSpoilers', value)} /><Toggle label="Play animated images automatically" checked={preferences.chat.gifAutoplay} onChange={(value) => updatePreference('chat', 'gifAutoplay', value)} /><Toggle label="Send with Enter" checked={preferences.chat.sendOnEnter} onChange={(value) => updatePreference('chat', 'sendOnEnter', value)} /><label className="block text-sm">Clock format<Select value={preferences.chat.clockFormat} onChange={(event) => updatePreference('chat', 'clockFormat', event.target.value as AppPreferences['chat']['clockFormat'])}><option value="12h">12-hour</option><option value="24h">24-hour</option></Select></label></div>}
                    {settingsPage === 'accessibility' && <div className="max-w-2xl space-y-5"><h2 className="text-lg font-semibold">Accessibility</h2><Toggle label="Reduce motion" checked={preferences.accessibility.reducedMotion} onChange={(value) => updatePreference('accessibility', 'reducedMotion', value)} /><Toggle label="Increase contrast" checked={preferences.accessibility.highContrast} onChange={(value) => updatePreference('accessibility', 'highContrast', value)} /><Toggle label="Underline links" checked={preferences.accessibility.underlineLinks} onChange={(value) => updatePreference('accessibility', 'underlineLinks', value)} /><Toggle label="Highlight keyboard focus" checked={preferences.accessibility.keyboardFocus} onChange={(value) => updatePreference('accessibility', 'keyboardFocus', value)} /><Toggle label="Allow animated emoji and stickers" checked={preferences.accessibility.animatedEmoji} onChange={(value) => updatePreference('accessibility', 'animatedEmoji', value)} /></div>}
                    {settingsPage === 'language' && <div className="max-w-2xl space-y-4"><h2 className="text-lg font-semibold">Language</h2><label className="block text-sm">App language<Select value={preferences.language} onChange={(event) => updateRootPreference('language', event.target.value)}><option value="en">English</option></Select></label><p className="text-xs text-cordly-muted">English is currently the complete language pack.</p></div>}
                    {settingsPage === 'shortcuts' && <div className="max-w-2xl space-y-4"><h2 className="text-lg font-semibold">Keyboard shortcuts</h2><div className="divide-y divide-cordly-border rounded-card border border-cordly-border">{[['Open settings', 'Ctrl / ⌘ + K'], ['Send message', 'Enter'], ['New line', 'Shift + Enter'], ['Close dialog', 'Escape'], ['Focus settings search', '/']].map(([label, key]) => <div key={label} className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{label}</span><kbd className="rounded border border-cordly-border bg-cordly-elevated px-2 py-1 text-xs text-cordly-secondary">{key}</kbd></div>)}</div><p className="text-xs text-cordly-muted">Shortcut rebinding is not yet available.</p></div>}
                    {settingsPage === 'advanced' && <div className="max-w-2xl space-y-5"><h2 className="text-lg font-semibold">Advanced</h2><Toggle label="Developer mode" description="Show technical identifiers and additional diagnostics." checked={preferences.developerMode} onChange={(value) => updateRootPreference('developerMode', value)} /><button type="button" onClick={() => { try { localStorage.clear(); window.location.reload(); } catch (clearError) { setSettingsError(getErrorMessage(clearError)); } }} className="rounded-control border border-cordly-border px-4 py-2 text-sm hover:bg-cordly-hover">Clear local cache</button></div>}
                    {settingsPage === 'connections' && <div className="max-w-2xl space-y-4"><h2 className="text-lg font-semibold">Connections</h2><p className="text-sm leading-6 text-cordly-secondary">No external account providers are configured for this installation.</p></div>}
                    {settingsPage === 'applications' && <div className="max-w-2xl space-y-4"><h2 className="text-lg font-semibold">Applications</h2><p className="text-sm leading-6 text-cordly-secondary">Application registration and personal access-token management are not configured.</p></div>}
                  </>
                )}
              </div>
              {settingsDirty && <footer className="flex shrink-0 items-center justify-between border-t border-cordly-border bg-cordly-surface px-5 py-3 sm:px-8"><p className="text-sm">You have unsaved changes.</p><div className="flex gap-2"><button type="button" onClick={resetSettingsDraft} className="rounded-control px-3 py-2 text-xs text-cordly-secondary hover:bg-cordly-hover">Reset</button><button type="submit" disabled={settingsSaving || settingsLoading} className="rounded-control bg-cordly-accent px-4 py-2 text-xs font-semibold text-white hover:bg-cordly-accent-hover disabled:opacity-50">{settingsSaving ? 'Saving…' : 'Save changes'}</button></div></footer>}
            </form>
          </section>
        </div>
      )}
      <SuccessToast message={successToast} exiting={toastExiting} onDismiss={dismissSuccessToast} />
    </main>
  );
}

function SuccessToast({ message, exiting, onDismiss }: { message: string; exiting: boolean; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className={`${exiting ? 'cordly-toast-exit' : 'cordly-toast-enter'} fixed left-1/2 top-5 z-[150] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#111216]/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/40 backdrop-blur-xl`}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400"><Check size={14} strokeWidth={3} /></span>
      <span className="truncate">{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="ml-1 rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X size={14} /></button>
    </div>
  );
}
