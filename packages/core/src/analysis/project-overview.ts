import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname, basename, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { detectLanguage } from "../utils/index.js";

const execFileAsync = promisify(execFile);

export interface ProjectOverview {
  name: string;
  rootPath: string;
  techStack: TechStackInfo;
  entryPoints: EntryPoint[];
  directoryStructure: DirectoryInfo[];
  fileStats: Record<string, number>;
  configFiles: string[];
  patterns: string[];
  packageManager: string | null;
  totalFiles: number;
  totalLines: number;
}

interface TechStackInfo {
  languages: Array<{ name: string; fileCount: number; percentage: number }>;
  frameworks: string[];
  buildTools: string[];
  testFrameworks: string[];
  linters: string[];
  runtimes: string[];
}

interface EntryPoint {
  type: string;
  path: string;
  description?: string;
}

interface DirectoryInfo {
  path: string;
  purpose: string;
  fileCount: number;
}

/**
 * Generate a comprehensive project overview by analyzing files, configs, and structure.
 * No LLM needed — purely heuristic-based.
 */
export async function analyzeProject(
  projectRoot: string,
  detailLevel: "compact" | "detailed" = "compact",
): Promise<ProjectOverview> {
  const files = await getFileList(projectRoot);
  const name = basename(projectRoot);

  // Analyze language distribution
  const langCounts: Record<string, number> = {};
  let totalLines = 0;

  for (const file of files) {
    const lang = detectLanguage(file);
    if (lang) {
      langCounts[lang] = (langCounts[lang] ?? 0) + 1;
    }
  }

  // Count lines for top languages (sampling if too many files)
  const fileSample = files.length > 500 ? files.slice(0, 500) : files;
  for (const file of fileSample) {
    try {
      const content = readFileSync(join(projectRoot, file), "utf-8");
      totalLines += content.split("\n").length;
    } catch {
      // skip
    }
  }
  if (files.length > 500) {
    totalLines = Math.round((totalLines / 500) * files.length);
  }

  const totalLangFiles = Object.values(langCounts).reduce((a, b) => a + b, 0);
  const languages = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, fileCount]) => ({
      name,
      fileCount,
      percentage: Math.round((fileCount / Math.max(totalLangFiles, 1)) * 100),
    }));

  // Detect frameworks, build tools, etc.
  const techStack = detectTechStack(projectRoot, files, languages);
  const entryPoints = detectEntryPoints(projectRoot, files);
  const directoryStructure = analyzeDirectories(
    projectRoot,
    files,
    detailLevel,
  );
  const configFiles = detectConfigFiles(files);
  const patterns = detectPatterns(projectRoot, files, directoryStructure);
  const packageManager = detectPackageManager(projectRoot);

  return {
    name,
    rootPath: projectRoot,
    techStack: { ...techStack, languages },
    entryPoints,
    directoryStructure,
    fileStats: langCounts,
    configFiles,
    patterns,
    packageManager,
    totalFiles: files.length,
    totalLines,
  };
}

async function getFileList(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    // Fallback to basic dir walk
    return walkDirSimple(cwd, cwd, 3);
  }
}

function walkDirSimple(root: string, dir: string, depth: number): string[] {
  if (depth <= 0) return [];
  const results: string[] = [];
  const ignore = new Set([
    "node_modules",
    ".git",
    ".abf",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    "target",
  ]);

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDirSimple(root, full, depth - 1));
      } else if (entry.isFile()) {
        results.push(relative(root, full));
      }
    }
  } catch {
    /* skip */
  }
  return results;
}

function detectTechStack(
  root: string,
  files: string[],
  languages: Array<{ name: string; fileCount: number }>,
): Omit<TechStackInfo, "languages"> {
  const frameworks: string[] = [];
  const buildTools: string[] = [];
  const testFrameworks: string[] = [];
  const linters: string[] = [];
  const runtimes: string[] = [];

  const fileSet = new Set(files);
  const hasFile = (name: string) => fileSet.has(name);

  // Read package.json if available
  let pkgJson: any = null;
  try {
    pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
  } catch {
    /* nope */
  }

  const allDeps = pkgJson
    ? {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
        ...pkgJson.peerDependencies,
      }
    : {};

  // Node.js / JavaScript frameworks
  if (allDeps["next"]) frameworks.push("Next.js");
  if (allDeps["react"]) frameworks.push("React");
  if (allDeps["vue"]) frameworks.push("Vue");
  if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) frameworks.push("Svelte");
  if (allDeps["astro"]) frameworks.push("Astro");
  if (allDeps["express"]) frameworks.push("Express");
  if (allDeps["fastify"]) frameworks.push("Fastify");
  if (allDeps["hono"]) frameworks.push("Hono");
  if (allDeps["nestjs"] || allDeps["@nestjs/core"]) frameworks.push("NestJS");
  if (allDeps["nuxt"]) frameworks.push("Nuxt");
  if (allDeps["angular"] || allDeps["@angular/core"])
    frameworks.push("Angular");
  if (allDeps["remix"] || allDeps["@remix-run/react"]) frameworks.push("Remix");
  if (allDeps["electron"]) frameworks.push("Electron");
  if (allDeps["react-native"]) frameworks.push("React Native");
  if (allDeps["tailwindcss"]) frameworks.push("Tailwind CSS");

  // Build tools
  if (allDeps["vite"] || hasFile("vite.config.ts") || hasFile("vite.config.js"))
    buildTools.push("Vite");
  if (allDeps["webpack"] || hasFile("webpack.config.js"))
    buildTools.push("Webpack");
  if (allDeps["esbuild"]) buildTools.push("esbuild");
  if (allDeps["rollup"] || hasFile("rollup.config.js"))
    buildTools.push("Rollup");
  if (allDeps["turbo"] || hasFile("turbo.json")) buildTools.push("Turborepo");
  if (hasFile("tsconfig.json")) buildTools.push("TypeScript");
  if (hasFile("Makefile")) buildTools.push("Make");
  if (hasFile("Dockerfile") || files.some((f) => f.endsWith("Dockerfile")))
    buildTools.push("Docker");

  // Test frameworks
  if (allDeps["vitest"]) testFrameworks.push("Vitest");
  if (allDeps["jest"]) testFrameworks.push("Jest");
  if (allDeps["mocha"]) testFrameworks.push("Mocha");
  if (allDeps["playwright"] || allDeps["@playwright/test"])
    testFrameworks.push("Playwright");
  if (allDeps["cypress"]) testFrameworks.push("Cypress");
  if (hasFile("pytest.ini") || hasFile("pyproject.toml"))
    testFrameworks.push("pytest");

  // Linters
  if (
    allDeps["eslint"] ||
    hasFile(".eslintrc.js") ||
    hasFile(".eslintrc.json") ||
    hasFile("eslint.config.js")
  )
    linters.push("ESLint");
  if (
    allDeps["prettier"] ||
    hasFile(".prettierrc") ||
    hasFile(".prettierrc.json")
  )
    linters.push("Prettier");
  if (allDeps["biome"] || hasFile("biome.json")) linters.push("Biome");
  if (hasFile(".flake8") || hasFile("setup.cfg")) linters.push("Flake8");
  if (hasFile("pyproject.toml")) {
    try {
      const pyproject = readFileSync(join(root, "pyproject.toml"), "utf-8");
      if (pyproject.includes("[tool.ruff]")) linters.push("Ruff");
      if (pyproject.includes("[tool.black]")) linters.push("Black");
      if (pyproject.includes("[tool.mypy]")) linters.push("mypy");
    } catch {
      /* skip */
    }
  }

  // Runtimes
  if (pkgJson) runtimes.push("Node.js");
  if (
    hasFile("requirements.txt") ||
    hasFile("pyproject.toml") ||
    hasFile("setup.py")
  )
    runtimes.push("Python");
  if (hasFile("go.mod")) runtimes.push("Go");
  if (hasFile("Cargo.toml")) runtimes.push("Rust");
  if (hasFile("Gemfile")) runtimes.push("Ruby");
  if (
    hasFile("pom.xml") ||
    hasFile("build.gradle") ||
    hasFile("build.gradle.kts")
  )
    runtimes.push("Java/JVM");
  if (hasFile("Package.swift")) runtimes.push("Swift");
  if (hasFile("composer.json")) runtimes.push("PHP");

  // Python frameworks
  if (files.some((f) => f.includes("django")) || hasFile("manage.py"))
    frameworks.push("Django");
  if (allDeps["flask"] || files.some((f) => f.endsWith("app.py"))) {
    try {
      const content = readFileSync(
        join(root, files.find((f) => f.endsWith("app.py")) ?? ""),
        "utf-8",
      );
      if (content.includes("Flask")) frameworks.push("Flask");
      if (content.includes("FastAPI")) frameworks.push("FastAPI");
    } catch {
      /* skip */
    }
  }

  return { frameworks, buildTools, testFrameworks, linters, runtimes };
}

function detectEntryPoints(root: string, files: string[]): EntryPoint[] {
  const entries: EntryPoint[] = [];

  // package.json entries
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    if (pkg.main) entries.push({ type: "main", path: pkg.main });
    if (pkg.module) entries.push({ type: "module", path: pkg.module });
    if (pkg.bin) {
      if (typeof pkg.bin === "string") {
        entries.push({ type: "bin", path: pkg.bin, description: pkg.name });
      } else {
        for (const [name, path] of Object.entries(pkg.bin)) {
          entries.push({
            type: "bin",
            path: path as string,
            description: name,
          });
        }
      }
    }
    if (pkg.exports) {
      if (typeof pkg.exports === "string") {
        entries.push({ type: "export", path: pkg.exports });
      } else if (pkg.exports["."]) {
        const main = pkg.exports["."];
        const path =
          typeof main === "string"
            ? main
            : (main.import ?? main.require ?? main.default);
        if (path) entries.push({ type: "export (.)", path });
      }
    }
  } catch {
    /* no package.json */
  }

  // Common entry points
  const commonEntries = [
    { file: "src/index.ts", type: "source entry" },
    { file: "src/index.tsx", type: "source entry" },
    { file: "src/main.ts", type: "source entry" },
    { file: "src/main.tsx", type: "source entry" },
    { file: "src/app.ts", type: "source entry" },
    { file: "src/App.tsx", type: "source entry" },
    { file: "index.ts", type: "root entry" },
    { file: "index.js", type: "root entry" },
    { file: "app.py", type: "python entry" },
    { file: "main.py", type: "python entry" },
    { file: "main.go", type: "go entry" },
    { file: "cmd/main.go", type: "go entry" },
    { file: "src/main.rs", type: "rust entry" },
    { file: "src/lib.rs", type: "rust entry" },
  ];

  const fileSet = new Set(files);
  for (const ce of commonEntries) {
    if (fileSet.has(ce.file) && !entries.some((e) => e.path === ce.file)) {
      entries.push({ type: ce.type, path: ce.file });
    }
  }

  return entries;
}

function analyzeDirectories(
  root: string,
  files: string[],
  detailLevel: "compact" | "detailed",
): DirectoryInfo[] {
  // Count files per top-level directory
  const dirCounts: Record<string, number> = {};
  for (const file of files) {
    const parts = file.split("/");
    if (parts.length > 1) {
      const topDir = parts[0];
      dirCounts[topDir] = (dirCounts[topDir] ?? 0) + 1;
    }
  }

  // Infer directory purposes
  const purposeMap: Record<string, string> = {
    src: "Source code",
    lib: "Library code",
    app: "Application code",
    pages: "Page components / routes",
    components: "UI components",
    hooks: "React hooks",
    utils: "Utility functions",
    helpers: "Helper functions",
    services: "Service layer / business logic",
    api: "API routes / endpoints",
    routes: "Route definitions",
    controllers: "Request handlers",
    models: "Data models",
    schemas: "Schema definitions",
    types: "Type definitions",
    interfaces: "Interface definitions",
    config: "Configuration",
    configs: "Configuration",
    test: "Tests",
    tests: "Tests",
    __tests__: "Tests",
    spec: "Test specifications",
    e2e: "End-to-end tests",
    fixtures: "Test fixtures",
    mocks: "Test mocks",
    public: "Static public assets",
    static: "Static files",
    assets: "Assets (images, fonts, etc.)",
    styles: "Stylesheets",
    css: "CSS files",
    docs: "Documentation",
    doc: "Documentation",
    scripts: "Build/utility scripts",
    bin: "Executable scripts",
    cmd: "Command entry points",
    internal: "Internal packages",
    pkg: "Public packages",
    packages: "Monorepo packages",
    apps: "Monorepo applications",
    migrations: "Database migrations",
    seeds: "Database seeds",
    prisma: "Prisma ORM",
    drizzle: "Drizzle ORM",
    middleware: "Middleware",
    plugins: "Plugins",
    extensions: "Extensions",
    i18n: "Internationalization",
    locales: "Locale files",
    vendor: "Third-party code",
    ".github": "GitHub config / CI",
    ".vscode": "VS Code config",
  };

  const dirs = Object.entries(dirCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([path, fileCount]) => ({
      path,
      purpose: purposeMap[path] ?? "Project directory",
      fileCount,
    }));

  return detailLevel === "compact" ? dirs.slice(0, 15) : dirs;
}

function detectConfigFiles(files: string[]): string[] {
  const configPatterns = [
    "package.json",
    "tsconfig.json",
    "tsconfig.*.json",
    ".eslintrc.js",
    ".eslintrc.json",
    "eslint.config.js",
    "eslint.config.mjs",
    ".prettierrc",
    ".prettierrc.json",
    "prettier.config.js",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "webpack.config.js",
    "turbo.json",
    "biome.json",
    ".env",
    ".env.example",
    ".env.local",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Dockerfile",
    "Makefile",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "go.mod",
    "go.sum",
    "Cargo.toml",
    "Gemfile",
    ".github/workflows/*.yml",
    ".github/workflows/*.yaml",
    "vitest.config.ts",
    "jest.config.ts",
    "jest.config.js",
    "tailwind.config.js",
    "tailwind.config.ts",
    "drizzle.config.ts",
  ];

  return files.filter((f) => {
    const base = basename(f);
    const dir = f.split("/").slice(0, -1).join("/");
    return configPatterns.some((p) => {
      if (p.includes("*")) {
        const regex = new RegExp(
          "^" + p.replace(/\./g, "\\.").replace(/\*/g, "[^/]*") + "$",
        );
        return regex.test(f) || regex.test(base);
      }
      return base === p || f === p;
    });
  });
}

function detectPatterns(
  root: string,
  files: string[],
  dirs: DirectoryInfo[],
): string[] {
  const patterns: string[] = [];

  // Monorepo detection
  const hasPackages = dirs.some((d) => d.path === "packages");
  const hasApps = dirs.some((d) => d.path === "apps");
  if (hasPackages || hasApps) patterns.push("Monorepo");
  if (existsSync(join(root, "turbo.json"))) patterns.push("Turborepo");
  if (existsSync(join(root, "lerna.json"))) patterns.push("Lerna");
  if (existsSync(join(root, "nx.json"))) patterns.push("Nx");

  // Architecture patterns
  const dirNames = new Set(dirs.map((d) => d.path));
  if (dirNames.has("controllers") && dirNames.has("models"))
    patterns.push("MVC pattern");
  if (dirNames.has("services") && dirNames.has("repositories"))
    patterns.push("Service-Repository pattern");
  if (
    files.some((f) => f.includes("/api/")) &&
    files.some((f) => f.includes("/pages/"))
  )
    patterns.push("Full-stack app");
  if (
    files.some(
      (f) =>
        f.endsWith(".test.ts") ||
        f.endsWith(".test.js") ||
        f.endsWith(".spec.ts"),
    )
  )
    patterns.push("Co-located tests");
  if (
    dirs.some(
      (d) => d.path === "test" || d.path === "tests" || d.path === "__tests__",
    )
  )
    patterns.push("Separate test directory");

  // API patterns
  if (files.some((f) => f.includes("graphql") || f.endsWith(".gql")))
    patterns.push("GraphQL");
  if (files.some((f) => f.includes("trpc") || f.includes("tRPC")))
    patterns.push("tRPC");
  if (files.some((f) => f.includes("openapi") || f.includes("swagger")))
    patterns.push("OpenAPI/Swagger");

  // ORM / DB
  if (files.some((f) => f.includes("prisma"))) patterns.push("Prisma ORM");
  if (files.some((f) => f.includes("drizzle"))) patterns.push("Drizzle ORM");
  if (files.some((f) => f.includes("migration")))
    patterns.push("Database migrations");

  return patterns;
}

function detectPackageManager(root: string): string | null {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")))
    return "bun";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  if (existsSync(join(root, "Pipfile.lock"))) return "pipenv";
  if (existsSync(join(root, "poetry.lock"))) return "poetry";
  if (existsSync(join(root, "uv.lock"))) return "uv";
  return null;
}
