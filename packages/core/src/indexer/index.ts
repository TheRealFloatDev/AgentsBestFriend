export {
  discoverFiles,
  type DiscoveredFile,
  type DiscoveryOptions,
} from "./discovery.js";
export {
  runIndexPipeline,
  getIndexStatus,
  type IndexStats,
  type IndexStatus,
} from "./pipeline.js";
export { watchProject, type WatcherHandle } from "./watcher.js";
