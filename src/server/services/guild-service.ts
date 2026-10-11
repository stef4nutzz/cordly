import { z } from 'zod';

import { Channel } from '@/models/Channel';
import { Guild } from '@/models/Guild';
import { GuildInvite } from '@/models/GuildInvite';
import { GuildCategory } from '@/models/GuildCategory';
import { GuildMember } from '@/models/GuildMember';

const guildNameSchema = z.string().trim().min(2).max(80);
const channelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .transform((name) => name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''))
  .pipe(z.string().min(1).max(80));

export async function createGuild(userObjectId: string, name: unknown) {
  const guildName = guildNameSchema.parse(name);
  const guild = await Guild.create({ name: guildName, ownerId: userObjectId });
  try {
    await GuildMember.create({ guildId: guild._id, userId: userObjectId, role: 'owner' });
    const channel = await Channel.create({
      guildId: guild._id,
      name: 'general',
      type: 'text',
    });
    return { guild, channel };
  } catch (error) {
    await Promise.all([
      GuildMember.deleteMany({ guildId: guild._id }),
      Channel.deleteMany({ guildId: guild._id }),
      Guild.deleteOne({ _id: guild._id }),
    ]);
    throw error;
  }
}

export async function createGuildChannel(
  userObjectId: string,
  publicGuildId: string,
  rawName: unknown,
  publicCategoryId?: unknown,
) {
  const name = channelNameSchema.parse(rawName);
  const guild = await Guild.findOne({ id: publicGuildId, deletedAt: null }).exec();
  if (!guild) return null;

  const membership = await GuildMember.findOne({
    guildId: guild._id,
    userId: userObjectId,
  }).exec();
  if (!membership || membership.role !== 'owner') return null;

  let categoryId: unknown = null;
  if (publicCategoryId !== undefined && publicCategoryId !== null && publicCategoryId !== '') {
    if (typeof publicCategoryId !== 'string') return null;
    const category = await GuildCategory.findOne({ id: publicCategoryId, guildId: guild._id }).select('_id').exec();
    if (!category) return null;
    categoryId = category._id;
  }

  return Channel.create({ guildId: guild._id, name, type: 'text', categoryId });
}

export async function joinGuild(userObjectId: string, inviteCode: unknown) {
  const parsedCode = z.string().trim().min(8).max(32).parse(inviteCode);
  const invite = await GuildInvite.findOne({ code: parsedCode }).select('guildId').exec();
  const guild = invite
    ? await Guild.findOne({ _id: invite.guildId, deletedAt: null }).exec()
    : await Guild.findOne({ inviteCode: parsedCode, deletedAt: null }).exec();
  if (!guild) return null;

  const existingMembership = await GuildMember.exists({ guildId: guild._id, userId: userObjectId });
  if (!existingMembership && invite) {
    const now = new Date();
    const usedInvite = await GuildInvite.findOneAndUpdate(
      {
        _id: invite._id,
        $and: [
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
          { $or: [{ maxUses: null }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
        ],
      },
      { $inc: { uses: 1 } },
      { new: true },
    ).exec();
    if (!usedInvite) return null;
  }
  await GuildMember.updateOne(
    { guildId: guild._id, userId: userObjectId },
    { $setOnInsert: { guildId: guild._id, userId: userObjectId, role: 'member' } },
    { upsert: true },
  ).exec();
  return guild;
}
