import type {
  LanguageParser,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./parser-types.js";

/**
 * Regex-based parser for Python files.
 * Extracts classes, functions/methods, and imports.
 */
export const pythonParser: LanguageParser = {
  languages: ["python"],

  parse(_filePath: string, content: string): ParseResult {
    const lines = content.split("\n");
    const symbols = extractPythonSymbols(lines);
    const imports = extractPythonImports(lines);
    return { symbols, imports };
  },
};

/**
 * Generic regex fallback parser for any language.
 * Recognizes common function/class/method patterns.
 */
export const regexFallbackParser: LanguageParser = {
  languages: [], // used as fallback when no specific parser matches

  parse(_filePath: string, content: string): ParseResult {
    const lines = content.split("\n");
    const symbols = extractGenericSymbols(lines);
    return { symbols, imports: [] };
  },
};

// ─── Python Parsing ──────────────────────────────────────────────────────────

function extractPythonSymbols(lines: string[]): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const stack: { indent: number; symbol: ParsedSymbol }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Class definition
    const classMatch = trimmed.match(/^class\s+(\w+)\s*(?:\([^)]*\))?\s*:/);
    if (classMatch) {
      const sym = finishAndCreate(
        classMatch[1],
        "class",
        i + 1,
        indent,
        `class ${classMatch[1]}`,
        stack,
        symbols,
        lines,
      );
      stack.push({ indent, symbol: sym });
      continue;
    }

    // Function/method definition
    const fnMatch = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
    if (fnMatch) {
      const isMethod =
        stack.length > 0 && stack[stack.length - 1].symbol.kind === "class";
      const kind: SymbolKind = isMethod ? "method" : "function";
      const sig = `${fnMatch[1]}(${fnMatch[2].trim()})`;
      const sym = finishAndCreate(
        fnMatch[1],
        kind,
        i + 1,
        indent,
        sig,
        stack,
        symbols,
        lines,
      );
      stack.push({ indent, symbol: sym });
      continue;
    }

    // Decorator (track as marker, don't create standalone symbol)
    // Variable at module level (only simple assignments)
    if (indent === 0) {
      const varMatch = trimmed.match(/^([A-Z_][A-Z_0-9]*)\s*[:=]/);
      if (varMatch && !trimmed.startsWith("#")) {
        symbols.push({
          name: varMatch[1],
          kind: "variable",
          startLine: i + 1,
          endLine: i + 1,
          exported: true,
          children: [],
        });
      }
    }
  }

  // Close remaining stack items
  while (stack.length > 0) {
    const item = stack.pop()!;
    item.symbol.endLine = findBlockEnd(
      lines,
      item.symbol.startLine - 1,
      item.indent,
    );
  }

  return symbols;
}

function finishAndCreate(
  name: string,
  kind: SymbolKind,
  startLine: number,
  indent: number,
  signature: string,
  stack: { indent: number; symbol: ParsedSymbol }[],
  topLevel: ParsedSymbol[],
  lines: string[],
): ParsedSymbol {
  // Pop stack items that are at same or deeper indentation
  while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
    const item = stack.pop()!;
    item.symbol.endLine = findBlockEnd(
      lines,
      item.symbol.startLine - 1,
      item.indent,
    );
  }

  const sym: ParsedSymbol = {
    name,
    kind,
    startLine,
    endLine: startLine, // will be updated when next sibling or end of file
    exported: indent === 0,
    signature,
    children: [],
  };

  if (stack.length > 0) {
    stack[stack.length - 1].symbol.children.push(sym);
  } else {
    topLevel.push(sym);
  }

  return sym;
}

function findBlockEnd(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) return i; // line i is no longer part of the block
  }
  return lines.length;
}

function extractPythonImports(lines: string[]): ParsedImport[] {
  const imports: ParsedImport[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // from X import Y, Z
    const fromMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
    if (fromMatch) {
      const symbols = fromMatch[2]
        .split(",")
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter(Boolean);
      imports.push({ targetPath: fromMatch[1], importedSymbols: symbols });
      continue;
    }

    // import X, Y
    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      const modules = importMatch[1].split(",").map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      );
      for (const mod of modules) {
        imports.push({ targetPath: mod, importedSymbols: ["*"] });
      }
    }
  }

  return imports;
}

// ─── Generic Regex Fallback ──────────────────────────────────────────────────

const GENERIC_PATTERNS: { pattern: RegExp; kind: SymbolKind }[] = [
  // Go, Rust, C-like function definitions
  { pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[(<]/, kind: "function" },
  { pattern: /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/, kind: "function" },
  // Java/Kotlin/C#/Swift methods
  {
    pattern:
      /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:\w+\s+)+(\w+)\s*\(/,
    kind: "function",
  },
  // Class definitions (many languages)
  {
    pattern: /^(?:pub\s+)?(?:abstract\s+)?(?:data\s+)?class\s+(\w+)/,
    kind: "class",
  },
  { pattern: /^(?:pub\s+)?struct\s+(\w+)/, kind: "class" },
  // Interface/trait/protocol
  {
    pattern: /^(?:pub\s+)?(?:interface|trait|protocol)\s+(\w+)/,
    kind: "interface",
  },
  // Enum
  { pattern: /^(?:pub\s+)?enum\s+(\w+)/, kind: "enum" },
  // Ruby def
  { pattern: /^def\s+(\w+)/, kind: "function" },
  // PHP function
  {
    pattern: /^(?:public|private|protected)?\s*function\s+(\w+)/,
    kind: "function",
  },
];

function extractGenericSymbols(lines: string[]): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("*")
    )
      continue;

    for (const { pattern, kind } of GENERIC_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        // Find matching closing brace for the block
        const endLine = findBraceEnd(lines, i);
        symbols.push({
          name: match[1],
          kind,
          startLine: i + 1,
          endLine,
          exported: true, // can't reliably detect in generic mode
          children: [],
        });
        break; // only match first pattern per line
      }
    }
  }

  return symbols;
}

function findBraceEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let foundOpen = false;

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") {
        depth--;
        if (foundOpen && depth === 0) return i + 1;
      }
    }
  }

  // If no braces found (could be a one-liner or different syntax), estimate
  return Math.min(startIdx + 1, lines.length);
}
