/**
 * Stub: internal-only connector text types.
 * ConnectorTextBlock is an internal content block type used behind
 * the CONNECTOR_TEXT feature flag.
 */

export interface ConnectorTextBlock {
  type: 'connector_text'
  text: string
}

export interface ConnectorTextDelta {
  type: 'connector_text_delta'
  text: string
}

export function isConnectorTextBlock(block: unknown): block is ConnectorTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: string }).type === 'connector_text'
  )
}
