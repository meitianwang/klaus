/**
 * Leader mailbox poller — ported from CC's cli/print.ts non-interactive path.
 *
 * In CC's interactive REPL, useInboxPoller (a React hook) polls the team-lead
 * mailbox every 1 s and submits unread messages as new turns. In CC's
 * non-interactive (-p) mode, print.ts does the same with a while-true loop
 * after each turn completes.
 *
 * Klaus has neither a React layer nor a print.ts. This module provides
 * startLeaderMailboxPoller() which engine-host.ts calls after spawning
 * in-process teammates, giving the leader the same "push" behaviour without
 * either of those CC-specific entry points.
 */

import { TEAMMATE_MESSAGE_TAG } from '../../constants/xml.js'
import type { AppState } from '../../state/AppState.js'
import { logForDebugging } from '../debug.js'
import { sleep } from '../sleep.js'
import {
  isStructuredProtocolMessage,
  markMessagesAsRead,
  readUnreadMessages,
} from '../teammateMailbox.js'
import { hasActiveInProcessTeammates, isTeamLead } from '../teammate.js'
import { TEAM_LEAD_NAME } from './constants.js'

const POLL_INTERVAL_MS = 500

/**
 * Start polling the leader's mailbox for incoming teammate messages.
 *
 * Mirrors the while-true loop in CC's print.ts (lines 2503-2632) and the
 * useInboxPoller React hook (useInboxPoller.ts).
 *
 * @param getAppState  – reads the current session AppState (same as toolUseContext.getAppState)
 * @param onMessages   – called with formatted XML when regular messages arrive;
 *                       engine-host.ts uses this to call chat() for the session
 * @param isSessionBusy – returns true when a chat turn is already running;
 *                        used to decide whether to deliver immediately or skip
 *                        (the next poll cycle will deliver when idle)
 * @returns cleanup function — call this to stop the poller
 */
export function startLeaderMailboxPoller(
  getAppState: () => AppState,
  onMessages: (formatted: string) => void,
  isSessionBusy: () => boolean,
): () => void {
  let stopped = false

  const poll = async () => {
    while (!stopped) {
      const appState = getAppState()

      // Stop when there are no more active in-process teammates.
      // Also mirrors CC print.ts: checks teamContext.teammates for tmux teammates,
      // but Klaus only uses in-process teammates.
      const hasActive =
        hasActiveInProcessTeammates(appState) ||
        (isTeamLead(appState.teamContext) &&
          Object.keys(appState.teamContext?.teammates ?? {}).length > 0)

      if (!hasActive) {
        logForDebugging('[leaderMailboxPoller] No active teammates, stopping')
        break
      }

      // Only deliver when the session is idle — if busy, wait for the next cycle.
      // (The turn that's running will finish soon and the next poll will fire.)
      if (!isSessionBusy()) {
        const teamName = appState.teamContext?.teamName
        let unread: Awaited<ReturnType<typeof readUnreadMessages>> = []
        try {
          unread = await readUnreadMessages(TEAM_LEAD_NAME, teamName)
        } catch {
          // Mailbox read errors are transient (file lock contention); retry next cycle.
        }

        if (unread.length > 0) {
          // Filter out structured protocol messages (permissions, shutdown, plan-approval).
          // Those are handled by in-process bridges and must not be injected as LLM context.
          // Mirrors CC print.ts + useInboxPoller filtering logic.
          const regular = unread.filter(m => !isStructuredProtocolMessage(m.text))

          if (regular.length > 0) {
            await markMessagesAsRead(TEAM_LEAD_NAME, teamName)

            // Format same as useInboxPoller (useInboxPoller.ts line 812-819)
            const formatted = regular
              .map(m => {
                const colorAttr = m.color ? ` color="${m.color}"` : ''
                const summaryAttr = m.summary ? ` summary="${m.summary}"` : ''
                return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${colorAttr}${summaryAttr}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`
              })
              .join('\n\n')

            logForDebugging(
              `[leaderMailboxPoller] Delivering ${regular.length} message(s) to leader`,
            )
            onMessages(formatted)
          } else {
            // Only protocol messages — mark them read so they don't accumulate.
            await markMessagesAsRead(TEAM_LEAD_NAME, teamName)
          }
        }
      }

      await sleep(POLL_INTERVAL_MS)
    }
  }

  void poll()

  return () => {
    stopped = true
  }
}
