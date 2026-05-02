export {
  buildNativeWikiIndex,
  ensureNativeWikiCurrent,
  evaluateNativeWiki,
  extractCitedFiles,
  getNativeWikiContextForIssue,
  getNativeWikiStatus,
  initializeNativeWiki,
  queryNativeWiki,
  updateNativeWiki,
} from "./wiki-native";

export type {
  NativeWikiBuildResult,
  NativeWikiDimensions,
  NativeWikiEvalReport,
  NativeWikiFileDimensions,
  NativeWikiFileEntry,
  NativeWikiGraph,
  NativeWikiGraphEdge,
  NativeWikiIndex,
  NativeWikiIssueContext,
  NativeWikiQueryResult,
  NativeWikiState,
  NativeWikiStatus,
  WikiPageSummary,
} from "./wiki-native";
