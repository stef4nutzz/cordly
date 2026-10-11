export interface SearchableMessage {
  content: string;
  createdAt: string;
  author: { username: string; tag: string };
  attachments: Array<{ contentType: string }>;
}

export function matchesMessageSearch(
  message: SearchableMessage,
  query: string,
  channelName: string,
  currentUser: { username: string; tag: string },
) {
  const terms = query.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((term) => term.replace(/^"|"$/g, '')) ?? [];
  const content = message.content.toLowerCase();
  const author = `${message.author.username}#${message.author.tag}`.toLowerCase();
  const timestamp = new Date(message.createdAt).getTime();
  const userMention = new RegExp(`@${escapeRegExp(currentUser.username)}(?:#${escapeRegExp(currentUser.tag)})?\\b`, 'i');

  return terms.every((term) => {
    const separator = term.indexOf(':');
    if (separator < 1) return content.includes(term.toLowerCase());
    const filter = term.slice(0, separator).toLowerCase();
    const value = term.slice(separator + 1).toLowerCase();
    if (!value) return content.includes(term.toLowerCase());
    switch (filter) {
      case 'from':
        return author.includes(value);
      case 'in':
        return channelName.toLowerCase().includes(value);
      case 'has':
        if (value === 'link') return /https?:\/\/\S+/i.test(message.content);
        if (value === 'image') return message.attachments.some((attachment) => attachment.contentType.startsWith('image/'));
        if (value === 'file') return message.attachments.length > 0;
        return false;
      case 'mentions':
        if (value === 'everyone' || value === 'here') return new RegExp(`@${value}\\b`, 'i').test(message.content);
        if (value === 'me' || value === 'self') return userMention.test(message.content);
        return message.content.toLowerCase().includes(`@${value}`);
      case 'before':
      case 'after': {
        const date = Date.parse(value);
        if (!Number.isFinite(date) || !Number.isFinite(timestamp)) return false;
        const boundary = new Date(date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) boundary.setHours(0, 0, 0, 0);
        return filter === 'before' ? timestamp < boundary.getTime() : timestamp >= boundary.getTime();
      }
      default:
        return content.includes(term.toLowerCase());
    }
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
