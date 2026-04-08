import type { ParseResult } from "./parser-types.js";
import { typescriptParser } from "./ts-parser.js";
import { pythonParser, regexFallbackParser } from "./regex-parser.js";
import { detectLanguage } from "../utils/index.js";

const parsers = [typescriptParser, pythonParser];
const parserMap = new Map<string, (typeof parsers)[number]>();
for (const p of parsers) {
  for (const lang of p.languages) {
    parserMap.set(lang, p);
  }
}

/**
 * Parse a file and extract symbols + imports.
 * Automatically selects the best parser based on file language.
 */
export function parseFile(filePath: string, content: string): ParseResult {
  const language = detectLanguage(filePath);
  const parser = language ? parserMap.get(language) : undefined;
  return (parser ?? regexFallbackParser).parse(filePath, content);
}
