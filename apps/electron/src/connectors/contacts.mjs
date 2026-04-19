// Klaus connector: macOS Contacts (via AppleScript)
import { runServer, osa, esc } from './_mcp.mjs'

runServer({
  name: 'klaus-macos-contacts',
  tools: [
    {
      name: 'search_contacts',
      description: 'Search contacts by name. Returns display name, primary phone, primary email.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 30 },
        },
        required: ['query'],
      },
      handler: async ({ query, limit = 30 }) => {
        const maxN = Math.max(1, Math.min(100, limit))
        const script = `
          set output to ""
          set matched to 0
          tell application "Contacts"
            set people_ to (people whose name contains "${esc(query)}")
            repeat with p in people_
              if matched ≥ ${maxN} then exit repeat
              set fullName to name of p
              set phoneStr to ""
              try
                if (count of phones of p) > 0 then set phoneStr to value of first phone of p
              end try
              set emailStr to ""
              try
                if (count of emails of p) > 0 then set emailStr to value of first email of p
              end try
              set output to output & fullName & "\t" & phoneStr & "\t" & emailStr & linefeed
              set matched to matched + 1
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const items = raw.split('\n').filter(Boolean).map(line => {
          const [name, phone, email] = line.split('\t')
          return { name, phone: phone || null, email: email || null }
        })
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: items.length, contacts: items }, null, 2) }] }
      },
    },

    {
      name: 'read_contact',
      description: 'Read full contact details by exact name match.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
      handler: async ({ name }) => {
        const script = `
          tell application "Contacts"
            set hits to people whose name is "${esc(name)}"
            if (count of hits) = 0 then return ""
            set p to item 1 of hits
            set result_ to (name of p) & linefeed
            try
              set result_ to result_ & "Organization: " & (organization of p) & linefeed
            end try
            try
              repeat with ph in phones of p
                set result_ to result_ & "Phone (" & (label of ph) & "): " & (value of ph) & linefeed
              end repeat
            end try
            try
              repeat with em in emails of p
                set result_ to result_ & "Email (" & (label of em) & "): " & (value of em) & linefeed
              end repeat
            end try
            try
              repeat with addr in addresses of p
                set result_ to result_ & "Address (" & (label of addr) & "): " & (formatted address of addr) & linefeed
              end repeat
            end try
            try
              set result_ to result_ & "Note: " & (note of p) & linefeed
            end try
            return result_
          end tell
        `
        const raw = await osa(script)
        if (!raw) throw new Error(`Contact not found: ${name}`)
        return { content: [{ type: 'text', text: raw }] }
      },
    },

    {
      name: 'create_contact',
      description: 'Create a new contact. Pass at least firstName; optionally lastName, phone, email.',
      inputSchema: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
          organization: { type: 'string' },
        },
        required: ['firstName'],
      },
      handler: async ({ firstName, lastName, phone, email, organization }) => {
        const props = [`first name:"${esc(firstName)}"`]
        if (lastName) props.push(`last name:"${esc(lastName)}"`)
        if (organization) props.push(`organization:"${esc(organization)}"`)
        const propStr = '{' + props.join(', ') + '}'
        const lines = [
          'tell application "Contacts"',
          `  set p to make new person with properties ${propStr}`,
        ]
        if (phone) lines.push(`  make new phone at end of phones of p with properties {label:"mobile", value:"${esc(phone)}"}`)
        if (email) lines.push(`  make new email at end of emails of p with properties {label:"work", value:"${esc(email)}"}`)
        lines.push('  save')
        lines.push('end tell')
        await osa(lines.join('\n'))
        const display = [firstName, lastName].filter(Boolean).join(' ')
        return { content: [{ type: 'text', text: `Created contact: ${display}` }] }
      },
    },

    {
      name: 'list_groups',
      description: 'List all contact groups.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const script = `
          set output to ""
          tell application "Contacts"
            repeat with g in groups
              set output to output & (name of g) & linefeed
            end repeat
          end tell
          return output
        `
        const raw = await osa(script)
        const names = raw.split('\n').map(s => s.trim()).filter(Boolean)
        return { content: [{ type: 'text', text: JSON.stringify({ count: names.length, groups: names }, null, 2) }] }
      },
    },

    {
      name: 'update_contact',
      description: 'Update an existing contact by exact name match. Replaces primary phone / email / organization / name fields when provided.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Current full name (first + last as displayed)' },
          newFirstName: { type: 'string' },
          newLastName: { type: 'string' },
          newOrganization: { type: 'string' },
          newPhone: { type: 'string', description: 'Replaces the first phone entry (or creates one)' },
          newEmail: { type: 'string', description: 'Replaces the first email entry (or creates one)' },
        },
        required: ['name'],
      },
      handler: async ({ name, newFirstName, newLastName, newOrganization, newPhone, newEmail }) => {
        if ([newFirstName, newLastName, newOrganization, newPhone, newEmail].every(v => v === undefined)) {
          throw new Error('Provide at least one new* field')
        }
        const lines = [
          'tell application "Contacts"',
          `  set hits to people whose name is "${esc(name)}"`,
          '  if (count of hits) = 0 then error "not_found"',
          '  set p to item 1 of hits',
        ]
        if (newFirstName !== undefined) lines.push(`  set first name of p to "${esc(newFirstName)}"`)
        if (newLastName !== undefined)  lines.push(`  set last name of p to "${esc(newLastName)}"`)
        if (newOrganization !== undefined) lines.push(`  set organization of p to "${esc(newOrganization)}"`)
        if (newPhone !== undefined) {
          lines.push('  if (count of phones of p) > 0 then')
          lines.push(`    set value of first phone of p to "${esc(newPhone)}"`)
          lines.push('  else')
          lines.push(`    make new phone at end of phones of p with properties {label:"mobile", value:"${esc(newPhone)}"}`)
          lines.push('  end if')
        }
        if (newEmail !== undefined) {
          lines.push('  if (count of emails of p) > 0 then')
          lines.push(`    set value of first email of p to "${esc(newEmail)}"`)
          lines.push('  else')
          lines.push(`    make new email at end of emails of p with properties {label:"work", value:"${esc(newEmail)}"}`)
          lines.push('  end if')
        }
        lines.push('  save')
        lines.push('end tell')
        try { await osa(lines.join('\n')) }
        catch (err) {
          if (String(err?.message || '').includes('not_found')) throw new Error(`Contact not found: ${name}`)
          throw err
        }
        return { content: [{ type: 'text', text: `Updated contact: ${name}` }] }
      },
    },

    {
      name: 'delete_contact',
      description: 'Delete a contact by exact name match. Irreversible.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
      handler: async ({ name }) => {
        const script = `
          tell application "Contacts"
            set hits to people whose name is "${esc(name)}"
            if (count of hits) = 0 then return "not_found"
            delete item 1 of hits
            save
            return "ok"
          end tell
        `
        const r = await osa(script)
        if (r === 'not_found') throw new Error(`Contact not found: ${name}`)
        return { content: [{ type: 'text', text: `Deleted contact: ${name}` }] }
      },
    },
  ],
})
