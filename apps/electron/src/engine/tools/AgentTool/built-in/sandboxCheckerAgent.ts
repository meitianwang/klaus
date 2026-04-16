import { AGENT_TOOL_NAME } from '../constants.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from '../../ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from '../../FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../GrepTool/prompt.js'
import { BASH_TOOL_NAME } from '../../BashTool/toolName.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../../NotebookEditTool/constants.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

function getSandboxCheckerSystemPrompt(): string {
  return `You are a security sandbox checker. Your only job is to determine whether a script accesses file system paths outside the allowed workspace.

Allowed paths: ~/workspace and ~/uploads (and any subdirectories thereof).

When given a script file path:
1. Read the file with the Read tool
2. Analyze ALL file system access patterns in the code, including:
   - Python: open(), os.path, pathlib.Path, shutil, glob, subprocess, os.system, etc.
   - Node.js: fs.*, require() with paths, import from paths, child_process, etc.
   - Ruby: File.*, IO.*, Open3, system(), backticks, etc.
   - Shell: cat, ls, cp, mv, find, etc. with absolute paths
   - Java: new File(), FileInputStream, Paths.get(), Runtime.exec(), etc.
   - Any absolute path literal in any language

3. Classification rules:
   - Relative paths (./foo, ../bar) resolved within workspace → COMPLIANT
   - Absolute paths within ~/workspace or ~/uploads → COMPLIANT
   - /etc/, /usr/, /home/, /Users/, /private/, /root/, /sys/, /proc/, or any other path not under the workspace → VIOLATION
   - Environment variable expansion that could resolve outside workspace → VIOLATION

Respond with ONLY one of:
- COMPLIANT
- VIOLATION: <one-line explanation of which path(s) are accessed>`
}

export const SANDBOX_CHECKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'sandbox-checker',
  whenToUse:
    'Security agent that checks whether a code file accesses file system paths outside the user workspace (~/workspace and ~/uploads). Invoke this agent before executing ANY code file or compiled binary via Bash — this includes scripts (python3, node, ruby, perl, php, lua, julia, r, sh, bash, zsh), compiled binaries (./program, java -jar, go run, cargo run), build tools (make, gradle, mvn, npm run, deno, bun), and any other executable file. Pass the file path as the task.',
  tools: [FILE_READ_TOOL_NAME],
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    BASH_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  model: 'haiku',
  maxTurns: 5,
  omitClaudeMd: true,
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: getSandboxCheckerSystemPrompt,
}
