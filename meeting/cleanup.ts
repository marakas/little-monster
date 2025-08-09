let cleanupHandler: ((meetingId: string) => Promise<void>) | null = null

export function registerCleanup(handler: NonNullable<typeof cleanupHandler>) {
  cleanupHandler = handler
}

export async function runCleanup(meetingId: string) {
  if (cleanupHandler) {
    await cleanupHandler(meetingId)
  }
}
