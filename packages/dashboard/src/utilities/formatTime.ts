/**
 * Format ISO 8601 timestamp as relative time (e.g., "5 minutes ago").
 * Returns absolute format if timestamp is null or invalid.
 */
export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return '—'

  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()

    // Prevent negative times
    if (diffMs < 0) return 'just now'

    const seconds = Math.floor(diffMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (seconds < 60) return 'just now'
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`

    // Fall back to absolute format for older dates
    return formatAbsoluteTime(isoString)
  } catch {
    return '—'
  }
}

/**
 * Format ISO 8601 timestamp as absolute time (e.g., "Jun 11, 2:34 PM").
 */
export function formatAbsoluteTime(isoString: string | null): string {
  if (!isoString) return '—'

  try {
    const date = new Date(isoString)
    const now = new Date()

    // Same day: show time only
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    }

    // Different day: show month, day, and time
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return '—'
  }
}

/**
 * Format ISO 8601 timestamp with both relative and absolute format.
 * E.g., "5 minutes ago (Jun 11, 2:34 PM)"
 */
export function formatTimeWithAbsolute(isoString: string | null): string {
  if (!isoString) return '—'
  const relative = formatRelativeTime(isoString)
  if (relative === '—') return '—'
  const absolute = formatAbsoluteTime(isoString)
  return `${relative} (${absolute})`
}
