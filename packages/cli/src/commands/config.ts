import * as clack from "@clack/prompts";
import { loadConfig, updateConfig, getConfigPath } from "@abf/core/config";

export async function configCommand(): Promise<void> {
  clack.intro("ABF Config");

  const config = loadConfig();
  clack.log.info(`Config file: ${getConfigPath()}`);

  const action = await clack.select({
    message: "What would you like to do?",
    options: [
      { value: "view", label: "View current config" },
      { value: "llm", label: "Configure LLM provider" },
      { value: "portal", label: "Configure portal port" },
      { value: "indexing", label: "Configure indexing" },
    ],
  });

  if (clack.isCancel(action)) {
    clack.outro("Cancelled");
    return;
  }

  if (action === "view") {
    console.log(JSON.stringify(config, null, 2));
    clack.outro("");
    return;
  }

  if (action === "llm") {
    const provider = await clack.select({
      message: "LLM provider:",
      options: [
        {
          value: "ollama",
          label: "Ollama (local)",
          hint: "Recommended — requires Ollama running locally",
        },
        {
          value: "none",
          label: "None",
          hint: "Disable summaries and semantic search",
        },
      ],
      initialValue: config.llm.provider,
    });

    if (clack.isCancel(provider)) return;

    if (provider === "ollama") {
      const baseUrl = await clack.text({
        message: "Ollama base URL:",
        initialValue: config.llm.ollama.baseUrl,
        validate: (v) => {
          try {
            new URL(v);
          } catch {
            return "Must be a valid URL";
          }
        },
      });
      if (clack.isCancel(baseUrl)) return;

      const summaryModel = await clack.text({
        message: "Summary model:",
        initialValue: config.llm.ollama.summaryModel,
      });
      if (clack.isCancel(summaryModel)) return;

      const embeddingModel = await clack.text({
        message: "Embedding model:",
        initialValue: config.llm.ollama.embeddingModel,
      });
      if (clack.isCancel(embeddingModel)) return;

      updateConfig({
        llm: {
          provider: "ollama",
          ollama: {
            baseUrl: baseUrl as string,
            summaryModel: summaryModel as string,
            embeddingModel: embeddingModel as string,
          },
        },
      });
    } else {
      updateConfig({ llm: { provider: "none", ollama: config.llm.ollama } });
    }

    clack.log.success("LLM config updated");
  }

  if (action === "portal") {
    const port = await clack.text({
      message: "Portal port:",
      initialValue: String(config.portal.port),
      validate: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1024 || n > 65535) {
          return "Must be a number between 1024 and 65535";
        }
      },
    });
    if (clack.isCancel(port)) return;

    updateConfig({ portal: { port: parseInt(port as string, 10) } });
    clack.log.success("Portal config updated");
  }

  if (action === "indexing") {
    const maxSize = await clack.text({
      message: "Max file size (KB):",
      initialValue: String(config.indexing.maxFileSizeKb),
      validate: (v) => {
        const n = parseInt(v, 10);
        if (isNaN(n) || n < 1) return "Must be a positive number";
      },
    });
    if (clack.isCancel(maxSize)) return;

    updateConfig({
      indexing: {
        ...config.indexing,
        maxFileSizeKb: parseInt(maxSize as string, 10),
      },
    });
    clack.log.success("Indexing config updated");
  }

  clack.outro("Done");
}
