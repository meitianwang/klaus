// Klaus connector: macOS Shortcuts (via `shortcuts` CLI, macOS 12+)
import { runServer, run } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-shortcuts',
  tools: [
    {
      name: 'list_shortcuts',
      description: 'List all installed Shortcuts on this Mac. Requires macOS 12 or later.',
      inputSchema: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Optional folder filter' },
        },
      },
      handler: async ({ folder }) => {
        const args = ['list']
        if (folder) args.push('--folder-name', folder)
        const out = await run('/usr/bin/shortcuts', args)
        const names = out.split('\n').map(s => s.trim()).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify({ count: names.length, shortcuts: names }, null, 2) }] }
      },
    },
    {
      name: 'run_shortcut',
      description: 'Run a Shortcut by exact name. Pass optional text input; returns text output if the shortcut produces any.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact Shortcut name' },
          input: { type: 'string', description: 'Text input to pipe to the shortcut (optional)' },
        },
        required: ['name'],
      },
      handler: async ({ name, input }) => {
        // `shortcuts run <name>` reads stdin when --input-path is -; emits output to stdout when --output-path is -.
        const args = ['run', name, '--output-path', '-']
        if (input !== undefined) args.push('--input-path', '-')
        const out = await run('/usr/bin/shortcuts', args, {
          stdin: input !== undefined ? input : undefined,
          timeout: 120_000,
        })
        const text = out.trim() || `Shortcut "${name}" ran with no output`
        return { content: [{ type: 'text', text }] }
      },
    },
  ],
})
