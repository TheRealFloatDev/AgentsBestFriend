import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConventionCategory =
  | "naming"
  | "structure"
  | "patterns"
  | "formatting";

export interface DetectedConvention {
  category: ConventionCategory;
  pattern: string;
  confidence: number; // 0–1
  examples: string[];
  description: string;
}

export interface ConventionsResult {
  conventions: DetectedConvention[];
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

export async function detectConventions(
  projectRoot: string,
  aspect: ConventionCategory | "all" = "all",
): Promise<ConventionsResult> {
  const conventions: DetectedConvention[] = [];

  // Collect a sample of files for analysis
  const sample = collectFileSample(projectRoot);

  if (aspect === "all" || aspect === "naming") {
    conventions.push(...detectNamingConventions(sample));
  }
  if (aspect === "all" || aspect === "structure") {
    conventions.push(...detectStructureConventions(projectRoot, sample));
  }
  if (aspect === "all" || aspect === "patterns") {
    conventions.push(...detectPatternConventions(sample));
  }
  if (aspect === "all" || aspect === "formatting") {
    conventions.push(...detectFormattingConventions(projectRoot));
  }

  // Sort by confidence (highest first)
  conventions.sort((a, b) => b.confidence - a.confidence);

  return { conventions };
}

// ─── File Sampling ───────────────────────────────────────────────────────────

interface FileSample {
  relativePath: string;
  basename: string;
  ext: string;
  language: string;
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".abf",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "__pycache__",
  ".venv",
  "venv",
  "coverage",
  ".turbo",
]);

function collectFileSample(projectRoot: string, maxFiles = 500): FileSample[] {
  const samples: FileSample[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 8 || samples.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (samples.length >= maxFiles) break;

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") || entry.name === ".github") {
          if (!IGNORE_DIRS.has(entry.name)) {
            walk(path.join(dir, entry.name), depth + 1);
          }
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const language = extToLang(ext);
        if (language) {
          samples.push({
            relativePath: path.relative(
              projectRoot,
              path.join(dir, entry.name),
            ),
            basename: entry.name,
            ext,
            language,
          });
        }
      }
    }
  }

  walk(projectRoot, 0);
  return samples;
}

function extToLang(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".swift": "swift",
    ".php": "php",
    ".vue": "vue",
    ".svelte": "svelte",
  };
  return map[ext] ?? "";
}

// ─── Naming Conventions ──────────────────────────────────────────────────────

function detectNamingConventions(sample: FileSample[]): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];

  // Analyze file naming patterns
  const namingStyles = {
    camelCase: 0,
    PascalCase: 0,
    "kebab-case": 0,
    snake_case: 0,
    SCREAMING_SNAKE: 0,
  };

  const examples: Record<string, string[]> = {
    camelCase: [],
    PascalCase: [],
    "kebab-case": [],
    snake_case: [],
    SCREAMING_SNAKE: [],
  };

  for (const file of sample) {
    const name = file.basename.replace(file.ext, "");
    // Skip index files and single-word names
    if (name === "index" || name === "main" || !/[A-Z_-]/.test(name)) continue;

    if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
      namingStyles.camelCase++;
      if (examples.camelCase.length < 4) examples.camelCase.push(file.basename);
    } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      namingStyles.PascalCase++;
      if (examples.PascalCase.length < 4)
        examples.PascalCase.push(file.basename);
    } else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) {
      namingStyles["kebab-case"]++;
      if (examples["kebab-case"].length < 4)
        examples["kebab-case"].push(file.basename);
    } else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(name)) {
      namingStyles.snake_case++;
      if (examples.snake_case.length < 4)
        examples.snake_case.push(file.basename);
    } else if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(name)) {
      namingStyles["SCREAMING_SNAKE"]++;
      if (examples["SCREAMING_SNAKE"].length < 4)
        examples["SCREAMING_SNAKE"].push(file.basename);
    }
  }

  const total = Object.values(namingStyles).reduce((a, b) => a + b, 0);
  if (total > 0) {
    const dominant = Object.entries(namingStyles).sort(
      ([, a], [, b]) => b - a,
    )[0];
    if (dominant[1] > 0) {
      conventions.push({
        category: "naming",
        pattern: `file-naming:${dominant[0]}`,
        confidence: Math.min(dominant[1] / total, 0.99),
        examples: examples[dominant[0]],
        description: `Files predominantly use ${dominant[0]} naming (${dominant[1]}/${total} multi-word files)`,
      });
    }
  }

  // Detect common suffixes (e.g., *.test.ts, *.spec.ts, *.module.ts)
  const suffixes = new Map<string, number>();
  const suffixExamples = new Map<string, string[]>();
  for (const file of sample) {
    const parts = file.basename.split(".");
    if (parts.length >= 3) {
      const suffix = parts[parts.length - 2];
      suffixes.set(suffix, (suffixes.get(suffix) ?? 0) + 1);
      const arr = suffixExamples.get(suffix) ?? [];
      if (arr.length < 3) arr.push(file.basename);
      suffixExamples.set(suffix, arr);
    }
  }

  for (const [suffix, count] of suffixes) {
    if (count >= 3) {
      conventions.push({
        category: "naming",
        pattern: `file-suffix:*.${suffix}.*`,
        confidence: Math.min((count / sample.length) * 5, 0.95),
        examples: suffixExamples.get(suffix) ?? [],
        description: `Common file suffix pattern: *.${suffix}.* (${count} files)`,
      });
    }
  }

  return conventions;
}

// ─── Structure Conventions ───────────────────────────────────────────────────

function detectStructureConventions(
  projectRoot: string,
  sample: FileSample[],
): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];

  // Detect folder organization patterns
  const topDirs = new Set<string>();
  for (const file of sample) {
    const parts = file.relativePath.split(path.sep);
    if (parts.length > 1) {
      topDirs.add(parts[0]);
    }
  }

  // Check for layer-based structure
  const layerDirs = [
    "src",
    "lib",
    "models",
    "controllers",
    "services",
    "routes",
    "middleware",
    "utils",
    "helpers",
    "types",
  ];
  const foundLayers = layerDirs.filter(
    (d) => topDirs.has(d) || hasSubDir(projectRoot, "src", d),
  );
  if (foundLayers.length >= 3) {
    conventions.push({
      category: "structure",
      pattern: "organization:layer-based",
      confidence: Math.min(foundLayers.length / 5, 0.95),
      examples: foundLayers.slice(0, 4),
      description: `Layer-based folder structure detected: ${foundLayers.join(", ")}`,
    });
  }

  // Check for feature-based structure
  const featureDirs = ["features", "modules", "domains", "pages", "components"];
  const foundFeatures = featureDirs.filter(
    (d) => topDirs.has(d) || hasSubDir(projectRoot, "src", d),
  );
  if (foundFeatures.length >= 1) {
    // Check if feature dirs contain mixed file types
    conventions.push({
      category: "structure",
      pattern: "organization:feature-based",
      confidence: Math.min(foundFeatures.length / 3, 0.9),
      examples: foundFeatures,
      description: `Feature/module-based folders: ${foundFeatures.join(", ")}`,
    });
  }

  // Detect monorepo
  if (topDirs.has("packages") || topDirs.has("apps") || topDirs.has("libs")) {
    const monoDirs = ["packages", "apps", "libs"].filter((d) => topDirs.has(d));
    conventions.push({
      category: "structure",
      pattern: "organization:monorepo",
      confidence: 0.95,
      examples: monoDirs,
      description: `Monorepo structure with: ${monoDirs.join(", ")}`,
    });
  }

  // Detect test file co-location vs separate test directory
  const testFiles = sample.filter(
    (f) =>
      f.basename.includes(".test.") ||
      f.basename.includes(".spec.") ||
      f.basename.startsWith("test_"),
  );
  const testsInTestDir = testFiles.filter(
    (f) =>
      f.relativePath.includes("__tests__") ||
      f.relativePath.startsWith("test/") ||
      f.relativePath.startsWith("tests/") ||
      f.relativePath.includes("/test/") ||
      f.relativePath.includes("/tests/"),
  );
  const testsColocated = testFiles.length - testsInTestDir.length;

  if (testFiles.length >= 3) {
    if (testsColocated > testsInTestDir.length) {
      conventions.push({
        category: "structure",
        pattern: "tests:co-located",
        confidence: Math.min(testsColocated / testFiles.length, 0.95),
        examples: testFiles.slice(0, 3).map((f) => f.relativePath),
        description: `Tests are co-located with source files (${testsColocated}/${testFiles.length})`,
      });
    } else {
      conventions.push({
        category: "structure",
        pattern: "tests:separate-directory",
        confidence: Math.min(testsInTestDir.length / testFiles.length, 0.95),
        examples: testsInTestDir.slice(0, 3).map((f) => f.relativePath),
        description: `Tests live in dedicated test directories (${testsInTestDir.length}/${testFiles.length})`,
      });
    }
  }

  return conventions;
}

function hasSubDir(root: string, ...parts: string[]): boolean {
  try {
    return fs.statSync(path.join(root, ...parts)).isDirectory();
  } catch {
    return false;
  }
}

// ─── Pattern Conventions ─────────────────────────────────────────────────────

function detectPatternConventions(sample: FileSample[]): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];

  // Detect common design pattern names in filenames
  const patternMap: Record<string, { regex: RegExp; label: string }> = {
    service: { regex: /service/i, label: "Service pattern" },
    controller: { regex: /controller/i, label: "Controller pattern" },
    repository: { regex: /repository|repo/i, label: "Repository pattern" },
    middleware: { regex: /middleware/i, label: "Middleware pattern" },
    factory: { regex: /factory/i, label: "Factory pattern" },
    hook: { regex: /^use[A-Z]/, label: "React hooks (useX)" },
    component: { regex: /\.component\./i, label: "Component suffix pattern" },
    module: { regex: /\.module\./i, label: "Module suffix pattern" },
    guard: { regex: /guard/i, label: "Guard pattern" },
    pipe: { regex: /\.pipe\./i, label: "Pipe pattern" },
    resolver: { regex: /resolver/i, label: "Resolver pattern" },
    dto: { regex: /\.dto\.|Dto/i, label: "DTO (Data Transfer Object) pattern" },
    model: { regex: /\.model\.|Model/i, label: "Model pattern" },
    schema: { regex: /\.schema\.|Schema/i, label: "Schema pattern" },
    util: { regex: /util|helper/i, label: "Utility/Helper pattern" },
  };

  for (const [key, { regex, label }] of Object.entries(patternMap)) {
    const matches = sample.filter((f) => regex.test(f.basename));
    if (matches.length >= 2) {
      conventions.push({
        category: "patterns",
        pattern: `design-pattern:${key}`,
        confidence: Math.min(matches.length / 10, 0.9),
        examples: matches.slice(0, 4).map((f) => f.basename),
        description: `${label} detected in ${matches.length} files`,
      });
    }
  }

  // Detect barrel/index pattern
  const indexFiles = sample.filter((f) => /^index\.[a-z]+$/.test(f.basename));
  if (indexFiles.length >= 5) {
    conventions.push({
      category: "patterns",
      pattern: "design-pattern:barrel-exports",
      confidence: Math.min(indexFiles.length / 20, 0.9),
      examples: indexFiles.slice(0, 4).map((f) => f.relativePath),
      description: `Barrel/index export pattern (${indexFiles.length} index files)`,
    });
  }

  return conventions;
}

// ─── Formatting Conventions ──────────────────────────────────────────────────

function detectFormattingConventions(
  projectRoot: string,
): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];

  // Check for config files that reveal formatting preferences
  const configChecks: {
    files: string[];
    parse: (content: string) => DetectedConvention[];
  }[] = [
    {
      files: [
        ".prettierrc",
        ".prettierrc.json",
        ".prettierrc.js",
        "prettier.config.js",
        "prettier.config.mjs",
      ],
      parse: parsePrettierConfig,
    },
    {
      files: [".editorconfig"],
      parse: parseEditorConfig,
    },
    {
      files: ["tsconfig.json"],
      parse: parseTsConfig,
    },
    {
      files: [
        ".eslintrc",
        ".eslintrc.json",
        "eslint.config.js",
        "eslint.config.mjs",
      ],
      parse: parseEslintPresence,
    },
    {
      files: ["biome.json", "biome.jsonc"],
      parse: parseBiomePresence,
    },
  ];

  for (const check of configChecks) {
    for (const file of check.files) {
      const fullPath = path.join(projectRoot, file);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        conventions.push(...check.parse(content));
        break; // Found one match for this config type
      } catch {
        // File doesn't exist
      }
    }
  }

  return conventions;
}

function parsePrettierConfig(content: string): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];
  try {
    const config = JSON.parse(content);
    if (config.semi !== undefined) {
      conventions.push({
        category: "formatting",
        pattern: `formatting:semicolons-${config.semi ? "yes" : "no"}`,
        confidence: 0.95,
        examples: [".prettierrc"],
        description: `Semicolons: ${config.semi ? "required" : "omitted"} (Prettier config)`,
      });
    }
    if (config.singleQuote !== undefined) {
      conventions.push({
        category: "formatting",
        pattern: `formatting:quotes-${config.singleQuote ? "single" : "double"}`,
        confidence: 0.95,
        examples: [".prettierrc"],
        description: `Quote style: ${config.singleQuote ? "single" : "double"} quotes (Prettier config)`,
      });
    }
    if (config.tabWidth) {
      conventions.push({
        category: "formatting",
        pattern: `formatting:indent-${config.useTabs ? "tabs" : `${config.tabWidth}spaces`}`,
        confidence: 0.95,
        examples: [".prettierrc"],
        description: `Indentation: ${config.useTabs ? "tabs" : `${config.tabWidth} spaces`} (Prettier config)`,
      });
    }
    if (config.trailingComma) {
      conventions.push({
        category: "formatting",
        pattern: `formatting:trailing-comma-${config.trailingComma}`,
        confidence: 0.9,
        examples: [".prettierrc"],
        description: `Trailing commas: ${config.trailingComma} (Prettier config)`,
      });
    }
  } catch {
    // Not valid JSON, might be JS config
    conventions.push({
      category: "formatting",
      pattern: "tooling:prettier",
      confidence: 0.9,
      examples: [".prettierrc"],
      description: "Prettier is configured for code formatting",
    });
  }
  return conventions;
}

function parseEditorConfig(content: string): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];
  const indentStyle = content.match(/indent_style\s*=\s*(\w+)/);
  const indentSize = content.match(/indent_size\s*=\s*(\d+)/);

  if (indentStyle) {
    conventions.push({
      category: "formatting",
      pattern: `formatting:indent-${indentStyle[1]}${indentSize ? `-${indentSize[1]}` : ""}`,
      confidence: 0.9,
      examples: [".editorconfig"],
      description: `Indentation: ${indentStyle[1]}${indentSize ? ` (size ${indentSize[1]})` : ""} (EditorConfig)`,
    });
  }

  return conventions;
}

function parseTsConfig(content: string): DetectedConvention[] {
  const conventions: DetectedConvention[] = [];
  try {
    // Strip comments for JSON parsing
    const stripped = content
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const config = JSON.parse(stripped);
    const co = config.compilerOptions;
    if (co?.strict) {
      conventions.push({
        category: "formatting",
        pattern: "typescript:strict-mode",
        confidence: 0.95,
        examples: ["tsconfig.json"],
        description: "TypeScript strict mode is enabled",
      });
    }
    if (co?.module) {
      conventions.push({
        category: "formatting",
        pattern: `typescript:module-${co.module.toLowerCase()}`,
        confidence: 0.9,
        examples: ["tsconfig.json"],
        description: `TypeScript module system: ${co.module}`,
      });
    }
  } catch {
    // Parsing failed
  }
  return conventions;
}

function parseEslintPresence(_content: string): DetectedConvention[] {
  return [
    {
      category: "formatting",
      pattern: "tooling:eslint",
      confidence: 0.9,
      examples: [".eslintrc / eslint.config"],
      description: "ESLint is configured for code linting",
    },
  ];
}

function parseBiomePresence(_content: string): DetectedConvention[] {
  return [
    {
      category: "formatting",
      pattern: "tooling:biome",
      confidence: 0.9,
      examples: ["biome.json"],
      description: "Biome is configured for linting and formatting",
    },
  ];
}
