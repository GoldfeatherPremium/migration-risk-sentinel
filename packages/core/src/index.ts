export {
  analyzeMigration,
  shouldFail,
  compareFindings,
  normalizePath,
  AnalyzerInputError,
  MAX_FILE_BYTES,
  MAX_FILES,
} from "./analyze.js";
export type { AnalyzeOptions } from "./analyze.js";
export { resolveConfig, ConfigSchema, ConfigError, isExcluded, globToRegExp } from "./config.js";
export type { UserConfig, ResolvedConfig } from "./config.js";
export { RULES, PLANNED_RULES, getRuleMeta } from "./rules.js";
export { toJSON, toMarkdown, toSarif } from "./reporters.js";
export { tokenize } from "./lexer.js";
export { parseFile } from "./parser.js";
export { VERSION } from "./version.js";
export * from "./types.js";
