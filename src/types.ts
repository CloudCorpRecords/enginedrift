/**
 * enginedrift types.
 *
 * enginedrift compares the Node versions a project declares in
 * up to three places — package.json `engines.node`, CI
 * `node-version` values, and Dockerfile `FROM node` tags — and
 * reports whether they drift apart. Each provided source is
 * summarised the same way: the raw strings it declared, the
 * majors that could be extracted from them, and a note when a
 * declaration cannot pin a major.
 */

export type SourceName = "package.json" | "ci" | "dockerfile";

/** One source's extraction summary. */
export interface SourceSummary {
  source: SourceName;
  /** Raw declared strings found, in order (package.json: at most one). */
  declared: string[];
  /** Majors found, ascending and unique. */
  majors: number[];
  /** Why a declaration pins no major, or null when not applicable. */
  note: string | null;
}

export type IssueCode =
  | "MAJOR_MISMATCH"
  | "BELOW_MINIMUM"
  | "UNPINNED_IMAGE"
  | "NO_ENGINES";

/** One drift finding. */
export interface DriftIssue {
  code: IssueCode;
  message: string;
}

/** The drift report. */
export interface EngineDriftResult {
  /** True iff MAJOR_MISMATCH or BELOW_MINIMUM fired. */
  drift: boolean;
  sources: SourceSummary[];
  issues: DriftIssue[];
}
