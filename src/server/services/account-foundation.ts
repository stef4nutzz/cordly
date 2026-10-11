import { randomInt } from 'node:crypto';

export type TagCandidate = () => string;

export function allocateUniqueTag(
  existingTags: ReadonlySet<string>,
  candidate: TagCandidate = () => String(randomInt(0, 10000)).padStart(4, '0'),
): string {
  const firstCandidate = candidate();
  if (!/^\d{4}$/.test(firstCandidate)) {
    throw new Error('Tag candidate generator must return exactly four digits.');
  }

  const start = Number(firstCandidate);
  for (let offset = 0; offset < 10000; offset += 1) {
    const tag = String((start + offset) % 10000).padStart(4, '0');
    if (!existingTags.has(tag)) return tag;
  }

  throw new Error('No unique username tag is available.');
}

export function shouldGrantInitialOwner(
  registeredEmail: string,
  configuredOwnerEmail: string | undefined,
  bootstrapAlreadyUsed: boolean,
): boolean {
  return Boolean(
    configuredOwnerEmail &&
      !bootstrapAlreadyUsed &&
      registeredEmail.trim().toLowerCase() === configuredOwnerEmail.trim().toLowerCase(),
  );
}
