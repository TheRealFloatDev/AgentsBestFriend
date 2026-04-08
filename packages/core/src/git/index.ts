export {
  isGitRepo,
  getRecentCommits,
  getFileHistory,
  getBlame,
  getDiff,
  getTrackedFiles,
} from "./client.js";

export type {
  GitCommit,
  GitBlameLine,
  GitDiff,
  GitFileHistory,
} from "./client.js";
