import type { ProviderDefinition } from "./types.js";

export const googleProvider: ProviderDefinition = {
  id: "google",
  label: "Google (Gemini)",
  protocol: "google",
  defaultBaseUrl: "",
  models: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tokens: 1048576 },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tokens: 1048576 },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", tokens: 1048576 },
  ],
};
