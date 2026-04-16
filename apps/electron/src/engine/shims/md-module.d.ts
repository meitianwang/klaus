// Declaration for importing .md files as text (Bun text loader shim)
declare module '*.md' {
  const content: string
  export default content
}
