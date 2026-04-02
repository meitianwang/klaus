import type { AgentTool } from "../klaus-agent-compat.js";
import { join } from "node:path";
import { CONFIG_DIR } from "../config.js";
import type {
  ToolFactory,
  HookName,
  HookHandler,
  HookRegistration,
  WebSearchProvider,
  MediaUnderstandingProvider,
  SpeechProvider,
  ImageGenerationProvider,
  HttpRouteDefinition,
  CommandDefinition,
  ServiceDefinition,
  ProviderAPI,
} from "./types.js";

interface ProviderTracking {
  tools: string[];
  hooks: string[];
  webSearch: string[];
  mediaUnderstanding: string[];
  speech: string[];
  imageGeneration: string[];
  httpRoutes: string[];
  commands: string[];
  services: string[];
}

export class CapabilityRegistry {
  private readonly tools = new Map<string, AgentTool | ToolFactory>();
  private readonly hooks = new Map<string, HookRegistration>();
  private readonly webSearch = new Map<string, WebSearchProvider>();
  private readonly mediaUnderstanding = new Map<string, MediaUnderstandingProvider>();
  private readonly speech = new Map<string, SpeechProvider>();
  private readonly imageGeneration = new Map<string, ImageGenerationProvider>();
  private readonly httpRoutes = new Map<string, HttpRouteDefinition[]>();
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly services = new Map<string, ServiceDefinition>();
  private readonly providerTracking = new Map<string, ProviderTracking>();
  private httpRoutesCache: HttpRouteDefinition[] | null = null;
  private toolIdCounter = 0;
  private hookIdCounter = 0;

  createAPI(providerId: string): ProviderAPI {
    const tracking: ProviderTracking = {
      tools: [], hooks: [],
      webSearch: [], mediaUnderstanding: [], speech: [],
      imageGeneration: [], httpRoutes: [], commands: [], services: [],
    };
    this.providerTracking.set(providerId, tracking);

    return {
      registerTool: (tool) => {
        const id = `${providerId}:tool:${this.toolIdCounter++}`;
        this.tools.set(id, tool);
        tracking.tools.push(id);
      },
      registerWebSearch: (p) => { this.webSearch.set(p.id, p); tracking.webSearch.push(p.id); },
      registerMediaUnderstanding: (p) => { this.mediaUnderstanding.set(p.id, p); tracking.mediaUnderstanding.push(p.id); },
      registerSpeech: (p) => { this.speech.set(p.id, p); tracking.speech.push(p.id); },
      registerImageGeneration: (p) => { this.imageGeneration.set(p.id, p); tracking.imageGeneration.push(p.id); },
      registerHttpRoute: (r) => {
        const routes = this.httpRoutes.get(providerId) ?? [];
        routes.push(r);
        this.httpRoutes.set(providerId, routes);
        tracking.httpRoutes.push(r.path);
        this.httpRoutesCache = null;
      },
      registerCommand: (c) => { this.commands.set(c.name, c); tracking.commands.push(c.name); },
      registerService: (s) => { this.services.set(s.id, s); tracking.services.push(s.id); },
      on: (name, handler, opts) => {
        const id = `${providerId}:hook:${this.hookIdCounter++}`;
        this.hooks.set(id, { name, handler: handler as (...args: unknown[]) => unknown, priority: opts?.priority });
        tracking.hooks.push(id);
      },
    };
  }

  getProviderServices(providerId: string): ServiceDefinition[] {
    const tracking = this.providerTracking.get(providerId);
    if (!tracking) return [];
    return tracking.services
      .map((id) => this.services.get(id))
      .filter((s): s is ServiceDefinition => s !== undefined);
  }

  removeProvider(providerId: string): void {
    const tracking = this.providerTracking.get(providerId);
    if (!tracking) return;
    for (const id of tracking.tools) this.tools.delete(id);
    for (const id of tracking.hooks) this.hooks.delete(id);
    for (const id of tracking.webSearch) this.webSearch.delete(id);
    for (const id of tracking.mediaUnderstanding) this.mediaUnderstanding.delete(id);
    for (const id of tracking.speech) this.speech.delete(id);
    for (const id of tracking.imageGeneration) this.imageGeneration.delete(id);
    this.httpRoutes.delete(providerId);
    this.httpRoutesCache = null;
    for (const name of tracking.commands) this.commands.delete(name);
    for (const id of tracking.services) this.services.delete(id);
    this.providerTracking.delete(providerId);
  }

  buildTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const entry of this.tools.values()) {
      if (typeof entry === "function") {
        const result = entry({});
        if (result) {
          if (Array.isArray(result)) tools.push(...result);
          else tools.push(result);
        }
      } else {
        tools.push(entry);
      }
    }
    for (const ws of this.webSearch.values()) {
      const tool = ws.createTool({});
      if (tool) tools.push(tool);
    }
    return tools;
  }

  getHooks<T extends HookName>(name: T): HookHandler<T>[] {
    return [...this.hooks.values()]
      .filter((h) => h.name === name)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((h) => h.handler as HookHandler<T>);
  }

  getWebSearchProviders(): WebSearchProvider[] {
    return [...this.webSearch.values()];
  }

  getMediaUnderstandingProviders(): MediaUnderstandingProvider[] {
    return [...this.mediaUnderstanding.values()];
  }

  getSpeechProviders(): SpeechProvider[] {
    return [...this.speech.values()];
  }

  getImageGenerationProviders(): ImageGenerationProvider[] {
    return [...this.imageGeneration.values()];
  }

  getAllHttpRoutes(): readonly HttpRouteDefinition[] {
    if (!this.httpRoutesCache) {
      const all: HttpRouteDefinition[] = [];
      for (const routes of this.httpRoutes.values()) all.push(...routes);
      this.httpRoutesCache = all;
    }
    return this.httpRoutesCache;
  }

  getCommands(): ReadonlyMap<string, CommandDefinition> {
    return this.commands;
  }

  getServices(): ServiceDefinition[] {
    return [...this.services.values()];
  }

  async startServices(): Promise<void> {
    for (const svc of this.services.values()) {
      await svc.start({ stateDir: join(CONFIG_DIR, "services", svc.id) });
      console.log(`[Capabilities] Service started: ${svc.id}`);
    }
  }

  async stopServices(): Promise<void> {
    for (const svc of this.services.values()) {
      try { await svc.stop?.({ stateDir: join(CONFIG_DIR, "services", svc.id) }); }
      catch (err) { console.error(`[Capabilities] Service stop failed: ${svc.id}`, err); }
    }
  }

  async stopProviderServices(providerId: string): Promise<void> {
    for (const svc of this.getProviderServices(providerId)) {
      try { await svc.stop?.({ stateDir: join(CONFIG_DIR, "services", svc.id) }); }
      catch (err) { console.warn(`[Capabilities] Service stop failed: ${svc.id}`, err); }
    }
  }

  getSummary(): Record<string, number> {
    return {
      tools: this.tools.size,
      hooks: this.hooks.size,
      webSearch: this.webSearch.size,
      mediaUnderstanding: this.mediaUnderstanding.size,
      speech: this.speech.size,
      imageGeneration: this.imageGeneration.size,
      httpRoutes: this.getAllHttpRoutes().length,
      commands: this.commands.size,
      services: this.services.size,
    };
  }
}
