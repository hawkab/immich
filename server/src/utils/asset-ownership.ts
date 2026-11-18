export const assetEventRecipients = (assets: { id: string; ownerId: string }[], actorId: string) => {
  const recipients = new Map<string, string[]>([[actorId, assets.map(({ id }) => id)]]);
  for (const { id, ownerId } of assets) {
    if (ownerId === actorId) {
      continue;
    }
    const ids = recipients.get(ownerId) ?? [];
    ids.push(id);
    recipients.set(ownerId, ids);
  }
  return recipients;
};
