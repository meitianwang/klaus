/**
 * React stubs — no-op replacements for React UI rendering.
 * Klaus runs headless (no terminal UI), so all render methods are stripped.
 */

// SetToolJSXFn stub — tools reference this type but never call it in Klaus
export type SetToolJSXFn = (jsx: unknown) => void
export const noopSetToolJSX: SetToolJSXFn = () => {}
