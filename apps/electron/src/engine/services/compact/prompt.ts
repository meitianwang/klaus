import type { PartialCompactDirection } from '../../types/message.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

// 跟 constants/prompts.ts:getLanguageSection 同源 —— 主对话 systemPrompt
// 已经按 settings.language 注入了 "Always respond in X"，但 compact 走独立
// LLM 子调用，user prompt（getCompactPrompt 返回）整段是英文 "Your task
// is to create a detailed summary..."，模型会顺着 user prompt 的英文语境
// 生成 summary。systemPrompt 那条 language 段距离太远、力度不够。
//
// 解法（同 qritor compact prompt）：把语言指令直接拼到 compact 的 user
// prompt 末尾，并显式说"the entire <analysis> and <summary> output,
// including section headers and content" 让模型不会把 "1. Primary
// Request and Intent:" 这类段标题留成英文。
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  zh: 'Chinese',
  en: 'English',
}
function getCompactLanguageSection(): string | null {
  const lang = getInitialSettings().language
  if (!lang) return null
  const displayName = LANGUAGE_DISPLAY_NAMES[lang] ?? lang
  return `# Language\nAlways respond in ${displayName}. Use ${displayName} for the entire <analysis> and <summary> output, including section headers and content.`
}

// Aggressive no-tools preamble. The cache-sharing fork path inherits the
// parent's full tool set (required for cache-key match), and on Sonnet 4.6+
// adaptive-thinking models the model sometimes attempts a tool call despite
// the weaker trailer instruction. With maxTurns: 1, a denied tool call means
// no text output → falls through to the streaming fallback (2.79% on 4.6 vs
// 0.01% on 4.5). Putting this FIRST and making it explicit about rejection
// consequences prevents the wasted turn.
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`

// Two variants: BASE scopes to "the conversation", PARTIAL scopes to "the
// recent messages". The <analysis> block is a drafting scratchpad that
// formatCompactSummary() strips before the summary reaches context.
//
// Adapted from CC's coding-flavored prompt to a domain-agnostic shape:
// Klaus serves writing / Q&A / planning / translation / brainstorming as
// well as coding. The instruction now asks for "specific details when
// applicable" rather than hard-coding file-names + code-snippets +
// function-signatures + file-edits, but keeps those exact items as
// concrete examples so coding sessions still produce them at the same
// fidelity as upstream CC.
const DETAILED_ANALYSIS_INSTRUCTION_BASE = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, concepts, references, and reasoning
   - Domain-specific details when applicable, e.g.
     - for coding sessions: file names, full code snippets, function signatures, file edits
     - for writing/research: outlines, quotes, source citations, drafted text
     - for planning/Q&A: enumerated options, constraints, agreed-upon definitions
     - for translation/proofreading: source-target pairs, terminology choices
   - Errors, misunderstandings, or course-corrections, and how they were resolved
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for accuracy and completeness, addressing each required element thoroughly.`

const DETAILED_ANALYSIS_INSTRUCTION_PARTIAL = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Analyze the recent messages chronologically. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, concepts, references, and reasoning
   - Domain-specific details when applicable, e.g.
     - for coding sessions: file names, full code snippets, function signatures, file edits
     - for writing/research: outlines, quotes, source citations, drafted text
     - for planning/Q&A: enumerated options, constraints, agreed-upon definitions
     - for translation/proofreading: source-target pairs, terminology choices
   - Errors, misunderstandings, or course-corrections, and how they were resolved
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for accuracy and completeness, addressing each required element thoroughly.`

const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing the substance of the conversation — decisions made, content produced, issues encountered, and any domain-specific details (code, drafts, citations, plans, translations, etc.) — so the work can be continued without losing context.

${DETAILED_ANALYSIS_INSTRUCTION_BASE}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail.
2. Key Topics and Concepts: List the important topics, concepts, technologies, frameworks, references, terminology, or domain knowledge discussed.
3. Important Information and Artifacts: Enumerate the concrete artifacts produced or examined and the key content the assistant or user contributed. Include domain-specific details with high fidelity when applicable, for example:
   - Coding sessions: file names + full code snippets + function signatures + file edits, with a note on why each is important.
   - Writing / research sessions: outline points, key passages drafted, quotes, source citations.
   - Planning / Q&A sessions: agreed-upon definitions, enumerated options, decisions and their rationale.
   - Translation / proofreading: source-target pairs, terminology choices.
   Pay special attention to the most recent messages and preserve verbatim text where useful.
4. Issues and Resolutions: List errors, misunderstandings, blockers, or course-corrections that came up, and how they were resolved. Pay special attention to specific user feedback, especially if the user told you to do something differently.
5. Problem Solving and Reasoning: Document the problems worked through and any ongoing reasoning, including options weighed and rationale.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the user's feedback and shifts in intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Focus: Describe precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages. Include domain-specific details (file names, code snippets, draft passages, decisions, etc.) where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

A section that does not apply to this conversation can be left brief or marked "N/A" — do not fabricate items just to fill the structure.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Topics and Concepts:
   - [Topic / concept 1]
   - [Topic / concept 2]
   - [...]

3. Important Information and Artifacts:
   - [Item 1 — file, draft passage, citation, decision, etc.]
      - [Why it matters]
      - [Verbatim content / code snippet / quote when applicable]
   - [Item 2]
      - [Verbatim content / code snippet / quote when applicable]
   - [...]

4. Issues and Resolutions:
    - [Issue or misunderstanding 1]:
      - [How it was resolved]
      - [User feedback if any]
    - [...]

5. Problem Solving and Reasoning:
   [Description of problems worked through and the reasoning applied]

6. All user messages:
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Focus:
   [Precise description of what was being worked on]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response. 

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on the drafted outline and any sources cited, and preserve verbatim quotes the user asked you to use.
</example>
`

const PARTIAL_COMPACT_PROMPT = `Your task is to create a detailed summary of the RECENT portion of the conversation — the messages that follow earlier retained context. The earlier messages are being kept intact and do NOT need to be summarized. Focus your summary on what was discussed, decided, produced, or accomplished in the recent messages only.

${DETAILED_ANALYSIS_INSTRUCTION_PARTIAL}

Your summary should include the following sections:

1. Primary Request and Intent: Capture the user's explicit requests and intents from the recent messages.
2. Key Topics and Concepts: List the important topics, concepts, technologies, references, terminology, or domain knowledge discussed recently.
3. Important Information and Artifacts: Enumerate concrete artifacts produced or examined and the key content contributed. Include domain-specific details with high fidelity when applicable (e.g. coding: file names + full code snippets + function signatures + file edits; writing/research: outlines, drafts, quotes, citations; planning/Q&A: options, decisions, definitions; translation: source-target pairs).
4. Issues and Resolutions: List errors, misunderstandings, or course-corrections, and how they were resolved.
5. Problem Solving and Reasoning: Document problems worked through and any ongoing reasoning.
6. All user messages: List ALL user messages from the recent portion that are not tool results.
7. Pending Tasks: Outline any pending tasks from the recent messages.
8. Current Focus: Describe precisely what was being worked on immediately before this summary request.
9. Optional Next Step: List the next step related to the most recent work. Include direct quotes from the most recent conversation.

A section that does not apply can be left brief or marked "N/A" — do not fabricate items just to fill the structure.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Topics and Concepts:
   - [Topic / concept 1]
   - [Topic / concept 2]

3. Important Information and Artifacts:
   - [Item 1 — file, draft passage, citation, decision, etc.]
      - [Why it matters]
      - [Verbatim content / code snippet / quote when applicable]

4. Issues and Resolutions:
    - [Issue description]:
      - [How it was resolved]

5. Problem Solving and Reasoning:
   [Description]

6. All user messages:
    - [Detailed non tool use user message]

7. Pending Tasks:
   - [Task 1]

8. Current Focus:
   [Precise description of what was being worked on]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the RECENT messages only (after the retained earlier context), following this structure and ensuring precision and thoroughness in your response.
`

// 'up_to': model sees only the summarized prefix (cache hit). Summary will
// precede kept recent messages, hence "Context for Continuing Work" section.
const PARTIAL_COMPACT_UP_TO_PROMPT = `Your task is to create a detailed summary of this conversation. This summary will be placed at the start of a continuing session; newer messages that build on this context will follow after your summary (you do not see them here). Summarize thoroughly so that someone reading only your summary and then the newer messages can fully understand what happened and continue the work.

${DETAILED_ANALYSIS_INSTRUCTION_BASE}

Your summary should include the following sections:

1. Primary Request and Intent: Capture the user's explicit requests and intents in detail.
2. Key Topics and Concepts: List important topics, concepts, technologies, references, terminology, or domain knowledge discussed.
3. Important Information and Artifacts: Enumerate concrete artifacts produced or examined and the key content contributed. Include domain-specific details with high fidelity when applicable (e.g. coding: file names + full code snippets + function signatures + file edits; writing/research: outlines, drafts, quotes, citations; planning/Q&A: options, decisions, definitions; translation: source-target pairs).
4. Issues and Resolutions: List errors, misunderstandings, or course-corrections, and how they were resolved.
5. Problem Solving and Reasoning: Document problems worked through and any ongoing reasoning.
6. All user messages: List ALL user messages that are not tool results.
7. Pending Tasks: Outline any pending tasks.
8. Work Completed: Describe what was accomplished by the end of this portion.
9. Context for Continuing Work: Summarize any context, decisions, or state that would be needed to understand and continue the work in subsequent messages.

A section that does not apply can be left brief or marked "N/A" — do not fabricate items just to fill the structure.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Topics and Concepts:
   - [Topic / concept 1]
   - [Topic / concept 2]

3. Important Information and Artifacts:
   - [Item 1 — file, draft passage, citation, decision, etc.]
      - [Why it matters]
      - [Verbatim content / code snippet / quote when applicable]

4. Issues and Resolutions:
    - [Issue description]:
      - [How it was resolved]

5. Problem Solving and Reasoning:
   [Description]

6. All user messages:
    - [Detailed non tool use user message]

7. Pending Tasks:
   - [Task 1]

8. Work Completed:
   [Description of what was accomplished]

9. Context for Continuing Work:
   [Key context, decisions, or state needed to continue the work]

</summary>
</example>

Please provide your summary following this structure, ensuring precision and thoroughness in your response.
`

const NO_TOOLS_TRAILER =
  '\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
  'an <analysis> block followed by a <summary> block. ' +
  'Tool calls will be rejected and you will fail the task.'

export function getPartialCompactPrompt(
  customInstructions?: string,
  direction: PartialCompactDirection = 'from',
): string {
  const template =
    direction === 'up_to'
      ? PARTIAL_COMPACT_UP_TO_PROMPT
      : PARTIAL_COMPACT_PROMPT
  let prompt = NO_TOOLS_PREAMBLE + template

  const languageSection = getCompactLanguageSection()
  if (languageSection) {
    prompt += `\n\n${languageSection}`
  }

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += NO_TOOLS_TRAILER

  return prompt
}

export function getCompactPrompt(customInstructions?: string): string {
  let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT

  const languageSection = getCompactLanguageSection()
  if (languageSection) {
    prompt += `\n\n${languageSection}`
  }

  if (customInstructions && customInstructions.trim() !== '') {
    prompt += `\n\nAdditional Instructions:\n${customInstructions}`
  }

  prompt += NO_TOOLS_TRAILER

  return prompt
}

/**
 * Formats the compact summary by stripping the <analysis> drafting scratchpad
 * and replacing <summary> XML tags with readable section headers.
 * @param summary The raw summary string potentially containing <analysis> and <summary> XML tags
 * @returns The formatted summary with analysis stripped and summary tags replaced by headers
 */
export function formatCompactSummary(summary: string): string {
  let formattedSummary = summary

  // Strip analysis section — it's a drafting scratchpad that improves summary
  // quality but has no informational value once the summary is written.
  formattedSummary = formattedSummary.replace(
    /<analysis>[\s\S]*?<\/analysis>/,
    '',
  )

  // Extract and format summary section
  const summaryMatch = formattedSummary.match(/<summary>([\s\S]*?)<\/summary>/)
  if (summaryMatch) {
    const content = summaryMatch[1] || ''
    formattedSummary = formattedSummary.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${content.trim()}`,
    )
  }

  // Clean up extra whitespace between sections
  formattedSummary = formattedSummary.replace(/\n\n+/g, '\n\n')

  return formattedSummary.trim()
}

export function getCompactUserSummaryMessage(
  summary: string,
  suppressFollowUpQuestions?: boolean,
  transcriptPath?: string,
  recentMessagesPreserved?: boolean,
): string {
  const formattedSummary = formatCompactSummary(summary)

  let baseSummary = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

${formattedSummary}`

  if (transcriptPath) {
    baseSummary += `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`
  }

  if (recentMessagesPreserved) {
    baseSummary += `\n\nRecent messages are preserved verbatim.`
  }

  if (suppressFollowUpQuestions) {
    let continuation = `${baseSummary}
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.`

    return continuation
  }

  return baseSummary
}
