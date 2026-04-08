// ─── Parser Abstraction ──────────────────────────────────────────────────────
// Common types for all language parsers (ts-morph, regex fallback, etc.)

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "method"
  | "property"
  | "export"
  | "module"
  | "enum"
  | "decorator";

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  exported: boolean;
  signature?: string;
  children: ParsedSymbol[];
}

export interface ParsedImport {
  /** The raw import path (e.g. "./foo", "react", "@scope/pkg") */
  targetPath: string;
  /** Named imports (e.g. ["useState", "useEffect"]) or ["*"] for namespace */
  importedSymbols: string[];
}

export interface ParseResult {
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
}

export interface LanguageParser {
  /** Languages this parser supports */
  languages: string[];
  /** Parse a file and extract symbols + imports */
  parse(filePath: string, content: string): ParseResult;
}
