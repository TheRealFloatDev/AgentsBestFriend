import { Project, SyntaxKind, Node, SourceFile } from "ts-morph";
import type {
  LanguageParser,
  ParseResult,
  ParsedSymbol,
  ParsedImport,
  SymbolKind,
} from "./parser-types.js";

// Shared ts-morph project (no type-checking, just parsing)
let sharedProject: Project | null = null;

function getProject(): Project {
  if (!sharedProject) {
    sharedProject = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        allowJs: true,
        jsx: 1, // SyntaxKind.React in ts compiler
      },
    });
  }
  return sharedProject;
}

export const typescriptParser: LanguageParser = {
  languages: ["typescript", "javascript"],

  parse(filePath: string, content: string): ParseResult {
    const project = getProject();

    // Use a temp file name that ts-morph can parse
    const ext = filePath.endsWith(".tsx")
      ? ".tsx"
      : filePath.endsWith(".jsx")
        ? ".jsx"
        : filePath.endsWith(".js") ||
            filePath.endsWith(".mjs") ||
            filePath.endsWith(".cjs")
          ? ".js"
          : ".ts";

    const tempName = `__abf_parse_${Date.now()}${ext}`;
    const sourceFile = project.createSourceFile(tempName, content, {
      overwrite: true,
    });

    try {
      const symbols = extractSymbols(sourceFile);
      const imports = extractImports(sourceFile);
      return { symbols, imports };
    } finally {
      project.removeSourceFile(sourceFile);
    }
  },
};

function extractSymbols(sourceFile: SourceFile): ParsedSymbol[] {
  const results: ParsedSymbol[] = [];

  // Functions
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName() ?? "(anonymous)";
    const children = extractMethodLike(fn);
    results.push({
      name,
      kind: "function",
      startLine: fn.getStartLineNumber(),
      endLine: fn.getEndLineNumber(),
      exported: fn.isExported(),
      signature: buildFunctionSignature(name, fn),
      children,
    });
  }

  // Classes
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName() ?? "(anonymous)";
    const children: ParsedSymbol[] = [];

    for (const method of cls.getMethods()) {
      children.push({
        name: method.getName(),
        kind: "method",
        startLine: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        exported: false,
        signature: buildFunctionSignature(method.getName(), method),
        children: [],
      });
    }

    for (const prop of cls.getProperties()) {
      children.push({
        name: prop.getName(),
        kind: "property",
        startLine: prop.getStartLineNumber(),
        endLine: prop.getEndLineNumber(),
        exported: false,
        children: [],
      });
    }

    results.push({
      name,
      kind: "class",
      startLine: cls.getStartLineNumber(),
      endLine: cls.getEndLineNumber(),
      exported: cls.isExported(),
      children,
    });
  }

  // Interfaces
  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    const children: ParsedSymbol[] = [];

    for (const prop of iface.getProperties()) {
      children.push({
        name: prop.getName(),
        kind: "property",
        startLine: prop.getStartLineNumber(),
        endLine: prop.getEndLineNumber(),
        exported: false,
        children: [],
      });
    }

    for (const method of iface.getMethods()) {
      children.push({
        name: method.getName(),
        kind: "method",
        startLine: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        exported: false,
        children: [],
      });
    }

    results.push({
      name,
      kind: "interface",
      startLine: iface.getStartLineNumber(),
      endLine: iface.getEndLineNumber(),
      exported: iface.isExported(),
      children,
    });
  }

  // Type aliases
  for (const ta of sourceFile.getTypeAliases()) {
    results.push({
      name: ta.getName(),
      kind: "type",
      startLine: ta.getStartLineNumber(),
      endLine: ta.getEndLineNumber(),
      exported: ta.isExported(),
      children: [],
    });
  }

  // Enums
  for (const en of sourceFile.getEnums()) {
    results.push({
      name: en.getName(),
      kind: "enum",
      startLine: en.getStartLineNumber(),
      endLine: en.getEndLineNumber(),
      exported: en.isExported(),
      children: en.getMembers().map((m) => ({
        name: m.getName(),
        kind: "property" as SymbolKind,
        startLine: m.getStartLineNumber(),
        endLine: m.getEndLineNumber(),
        exported: false,
        children: [],
      })),
    });
  }

  // Top-level variable declarations (const/let/var)
  for (const vs of sourceFile.getVariableStatements()) {
    const isExported = vs.isExported();
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      // Check if it's an arrow function or function expression
      const init = decl.getInitializer();
      const isFunc =
        init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init));

      results.push({
        name,
        kind: isFunc ? "function" : "variable",
        startLine: vs.getStartLineNumber(),
        endLine: vs.getEndLineNumber(),
        exported: isExported,
        signature: isFunc ? buildArrowSignature(name, init) : undefined,
        children: [],
      });
    }
  }

  return results;
}

function extractImports(sourceFile: SourceFile): ParsedImport[] {
  const results: ParsedImport[] = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    const targetPath = imp.getModuleSpecifierValue();
    const symbols: string[] = [];

    const defaultImport = imp.getDefaultImport();
    if (defaultImport) symbols.push(defaultImport.getText());

    const nsImport = imp.getNamespaceImport();
    if (nsImport) symbols.push("*");

    for (const named of imp.getNamedImports()) {
      symbols.push(named.getName());
    }

    if (symbols.length === 0) symbols.push("*"); // side-effect import

    results.push({ targetPath, importedSymbols: symbols });
  }

  // Also handle require() calls at top level
  for (const vs of sourceFile.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && Node.isCallExpression(init)) {
        const expr = init.getExpression();
        if (Node.isIdentifier(expr) && expr.getText() === "require") {
          const args = init.getArguments();
          if (args.length > 0 && Node.isStringLiteral(args[0])) {
            results.push({
              targetPath: args[0].getLiteralValue(),
              importedSymbols: [decl.getName()],
            });
          }
        }
      }
    }
  }

  return results;
}

function buildFunctionSignature(
  name: string,
  fn: {
    getParameters: () => {
      getName: () => string;
      getType: () => { getText: () => string };
    }[];
    getReturnType?: () => { getText: () => string };
  },
): string {
  try {
    const params = fn
      .getParameters()
      .map((p) => {
        try {
          return `${p.getName()}: ${p.getType().getText()}`;
        } catch {
          return p.getName();
        }
      })
      .join(", ");
    let ret = "";
    try {
      if (fn.getReturnType) {
        const rt = fn.getReturnType().getText();
        if (rt && rt !== "void") ret = `: ${rt}`;
      }
    } catch {
      // ignore
    }
    return `${name}(${params})${ret}`;
  } catch {
    return name;
  }
}

function buildArrowSignature(name: string, node: Node): string {
  try {
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const params = (node as any)
        .getParameters()
        .map((p: any) => {
          try {
            return `${p.getName()}: ${p.getType().getText()}`;
          } catch {
            return p.getName();
          }
        })
        .join(", ");
      return `${name}(${params})`;
    }
  } catch {
    // ignore
  }
  return name;
}

function extractMethodLike(_node: Node): ParsedSymbol[] {
  // Top-level functions don't have method children in TS
  return [];
}
