// Why: no API reads macOS notification auth directly, so the probe and the live
// dispatch paths share the last observed outcome; session-scoped because the
// user can change permission between runs. Lives apart from both consumers so
// notifications.ts and notification-dispatch.ts avoid an import cycle.
let lastObservedDeliveryOutcome: 'delivered' | 'failed' | null = null

export function recordNotificationDeliveryOutcome(outcome: 'delivered' | 'failed'): void {
  lastObservedDeliveryOutcome = outcome
}

export function getNotificationDeliveryOutcome(): 'delivered' | 'failed' | null {
  return lastObservedDeliveryOutcome
}

export function resetNotificationDeliveryEvidence(): void {
  lastObservedDeliveryOutcome = null
}
