/**
 * iMessage channel types.
 * Uses the `imsg` CLI tool for macOS Messages app integration.
 */

export type IMessageConfig = {
  cliPath: string;  // Path to imsg binary (default: "imsg")
  dbPath?: string;  // Custom Messages database path
};

/** JSON-RPC message from imsg process. */
export type ImsgRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown;
};

/** Inbound message notification from imsg. */
export type ImsgInboundMessage = {
  id: string;
  sender: string;        // phone number or email
  text: string;
  chat_id?: string;      // group chat ID
  is_group: boolean;
  service: "iMessage" | "SMS";
  date: string;          // ISO timestamp
  attachments?: string[];
};
