import { emitRealtime } from '@/lib/realtime/instance';
import { Friendship } from '@/models/Friendship';
import { Guild } from '@/models/Guild';
import { GuildMember } from '@/models/GuildMember';
import { User } from '@/models/User';

type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline';

export async function publishPresence(userObjectId: string, online: boolean, status?: PresenceStatus) {
  const user = await User.findById(userObjectId).select('id status')
    .lean<{ id: string; status: 'online' | 'idle' | 'dnd' | 'offline' }>().exec();
  if (!user) return;
  const [friendships, memberships] = await Promise.all([
    Friendship.find({
      status: 'accepted',
      $or: [{ requesterId: userObjectId }, { recipientId: userObjectId }],
    }).select('requesterId recipientId').lean().exec(),
    GuildMember.find({ userId: userObjectId }).select('guildId').lean().exec(),
  ]);
  const otherUserIds = friendships.map((friendship) =>
    friendship.requesterId.toString() === userObjectId
      ? friendship.recipientId
      : friendship.requesterId,
  );
  const [friends, guilds] = await Promise.all([
    otherUserIds.length ? User.find({ _id: { $in: otherUserIds } }).select('id').lean().exec() : [],
    memberships.length
      ? Guild.find({ _id: { $in: memberships.map((membership) => membership.guildId) }, deletedAt: null })
        .select('id').lean().exec()
      : [],
  ]);
  const payload = {
    userId: user.id,
    status: status ?? user.status,
    online,
  };
  for (const friend of friends) emitRealtime(`user:${friend.id}`, 'presence:updated', payload);
  for (const guild of guilds) emitRealtime(`guild:${guild.id}`, 'presence:updated', payload);
}
