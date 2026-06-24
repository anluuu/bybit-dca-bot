export function isSenderAllowed(
  allowedSenderIds: ReadonlySet<number>,
  senderId: number | null,
  enforceSenderWhitelist: boolean
): boolean {
  if (!enforceSenderWhitelist || allowedSenderIds.size === 0) return true;
  return senderId != null && allowedSenderIds.has(senderId);
}
