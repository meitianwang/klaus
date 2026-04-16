/**
 * Type declarations for bun:sqlite.
 *
 * At runtime Bun provides this module natively. This declaration file
 * allows TypeScript to resolve the import when type-checking outside Bun
 * (e.g. with plain tsc).
 */
declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { readonly?: boolean });
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Statement<T>;
    transaction<F extends (...args: any[]) => any>(fn: F): F;
    close(): void;
  }

  export class Statement<T = unknown> {
    run(...params: any[]): void;
    get(...params: any[]): T | null;
    all(...params: any[]): T[];
  }
}
