/**
 * BashTool prompt — simplified from claude-code's BashTool/prompt.ts.
 * Stripped: sandbox section, undercover, attribution, embedded search tools,
 *           GrowthBook, feature flags.
 * Preserved: core instructions, git/PR instructions, tool preferences.
 */

const BASH_TOOL_NAME = 'Bash'

export const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
export const MAX_TIMEOUT_MS = 600_000 // 10 minutes

export function getDefaultTimeoutMs(): number {
  return DEFAULT_TIMEOUT_MS
}

export function getMaxTimeoutMs(): number {
  return MAX_TIMEOUT_MS
}

export function getSimplePrompt(): string {
  return [
    'Executes a given bash command and returns its output.',
    '',
    "The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).",
    '',
    'IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:',
    '',
    ' - File search: Use Glob (NOT find or ls)',
    ' - Content search: Use Grep (NOT grep or rg)',
    ' - Read files: Use Read (NOT cat/head/tail)',
    ' - Edit files: Use Edit (NOT sed/awk)',
    ' - Write files: Use Write (NOT echo >/cat <<EOF)',
    ' - Communication: Output text directly (NOT echo/printf)',
    `While the ${BASH_TOOL_NAME} tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.`,
    '',
    '# Instructions',
    ' - If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists and is the correct location.',
    ' - Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")',
    ' - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.',
    ` - You may specify an optional timeout in milliseconds (up to ${MAX_TIMEOUT_MS}ms / ${MAX_TIMEOUT_MS / 60000} minutes). By default, your command will timeout after ${DEFAULT_TIMEOUT_MS}ms (${DEFAULT_TIMEOUT_MS / 60000} minutes).`,
    " - You can use the `run_in_background` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later. You do not need to check the output right away - you'll be notified when it finishes. You do not need to use '&' at the end of the command when using this parameter.",
    ' - When issuing multiple commands:',
    `   - If the commands are independent and can run in parallel, make multiple ${BASH_TOOL_NAME} tool calls in a single message.`,
    `   - If the commands depend on each other and must run sequentially, use a single ${BASH_TOOL_NAME} call with '&&' to chain them together.`,
    "   - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.",
    '   - DO NOT use newlines to separate commands (newlines are ok in quoted strings).',
    ' - For git commands:',
    '   - Prefer to create a new commit rather than amending an existing commit.',
    '   - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal.',
    '   - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it.',
    ' - Avoid unnecessary `sleep` commands:',
    '   - Do not sleep between commands that can run immediately — just run them.',
    '   - If your command is long running and you would like to be notified when it finishes — use `run_in_background`. No sleep needed.',
    '   - Do not retry failing commands in a sleep loop — diagnose the root cause.',
    '   - If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll.',
    '   - If you must sleep, keep the duration short (1-5 seconds) to avoid blocking the user.',
  ].join('\n')
}
