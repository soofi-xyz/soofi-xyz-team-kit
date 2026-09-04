#!/usr/bin/env node
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseArgs } from "node:util";

const DEFAULT_BUCKET = "elephant-oracle-node-environmentbucket-mmsoo3xbdi80";
const DEFAULT_PREFIX =
  "permit-harvest/lee-permit-backfill-20260525/lee/permit-lists/";
const DEFAULT_START_DATE = "1990-01-01";
const DEFAULT_END_DATE = "2026-05-25";
const DEFAULT_RECENT_MINUTES = 60;
const DEFAULT_CONCURRENCY = 30;
const DEFAULT_SPLIT_THRESHOLD = 100;

/**
 * @typedef {object} ListObjectSummary
 * @property {string} key - S3 object key for a Lee permit list-window summary.
 * @property {string | null} lastModified - ISO timestamp for the summary object LastModified value.
 */

/**
 * @typedef {object} LeePermitListSummary
 * @property {string} windowKey - Stable window key in YYYYMMDD_YYYYMMDD format.
 * @property {string} startDate - Inclusive window start date as YYYY-MM-DD.
 * @property {string} endDate - Inclusive window end date as YYYY-MM-DD.
 * @property {number | null} reportedTotal - Accela-reported result count, or null when unavailable.
 * @property {number} discoveredPermitCount - Permit links discovered in the captured window result.
 * @property {boolean} truncatedForSplit - Whether the worker stopped after the first page because the window needed splitting.
 * @property {boolean} noResults - Whether Accela reported no results.
 */

/**
 * @typedef {object} EnrichedWindowSummary
 * @property {string} key - S3 object key for the summary.
 * @property {string | null} lastModified - ISO timestamp for the summary object LastModified value.
 * @property {string} windowKey - Stable window key in YYYYMMDD_YYYYMMDD format.
 * @property {string} startDate - Inclusive window start date as YYYY-MM-DD.
 * @property {string} endDate - Inclusive window end date as YYYY-MM-DD.
 * @property {number} span - Inclusive number of days covered by this window.
 * @property {number | null} reportedTotal - Accela-reported result count, or null when unavailable.
 * @property {number} discoveredPermitCount - Permit links discovered in the captured window result.
 * @property {boolean} truncatedForSplit - Whether the worker stopped after the first page because the window needed splitting.
 * @property {boolean} splitRequired - Whether the worker should split this summary into smaller date windows.
 * @property {boolean} terminal - Whether this summary is terminal for the current splitting algorithm.
 * @property {boolean} noResults - Whether Accela reported no results.
 */

/**
 * @typedef {object} ProgressOptions
 * @property {string} bucket - S3 bucket containing permit list summaries.
 * @property {string} prefix - S3 prefix containing permit list summaries.
 * @property {string} startDate - Overall harvest start date as YYYY-MM-DD.
 * @property {string} endDate - Overall harvest end date as YYYY-MM-DD.
 * @property {number} recentMinutes - Recent-throughput window size in minutes.
 * @property {number} concurrency - Number of concurrent S3 GetObject requests.
 * @property {number} splitThreshold - Accela reported-total threshold that triggers splitting.
 */

/**
 * Parse a YYYY-MM-DD value as a UTC date.
 *
 * @param {string} value - Date string as YYYY-MM-DD.
 * @returns {Date} UTC date object at midnight.
 */
function parseDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Format a Date as YYYY-MM-DD.
 *
 * @param {Date} date - Date to format.
 * @returns {string} ISO calendar date.
 */
function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Add whole days to a Date without mutating the input.
 *
 * @param {Date} date - Base date.
 * @param {number} days - Whole days to add.
 * @returns {Date} New date offset by the requested days.
 */
function addDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * Build a day-index helper relative to a configured start date.
 *
 * @param {string} overallStartDate - Overall harvest start date as YYYY-MM-DD.
 * @returns {(date: string) => number} Function that converts a date to a zero-based day index.
 */
function createDayIndex(overallStartDate) {
  const start = parseDate(overallStartDate);
  return (date) =>
    Math.floor((parseDate(date).getTime() - start.getTime()) / 86_400_000);
}

/**
 * Convert a map keyed by numbers to a sorted plain object.
 *
 * @param {Map<number, number>} map - Map to convert.
 * @returns {Record<string, number>} Sorted object representation.
 */
function sortedNumberMapToObject(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([key, value]) => [String(key), value]),
  );
}

/**
 * Read a required string option.
 *
 * @param {Record<string, string | boolean | undefined>} values - Parsed CLI values.
 * @param {string} optionName - Option name.
 * @param {string} defaultValue - Default value when the option is absent.
 * @returns {string} Option value.
 */
function readStringOption(values, optionName, defaultValue) {
  const value = values[optionName];
  if (value === undefined) return defaultValue;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${optionName} must be a non-empty string`);
  }
  return value;
}

/**
 * Read a positive integer option.
 *
 * @param {Record<string, string | boolean | undefined>} values - Parsed CLI values.
 * @param {string} optionName - Option name.
 * @param {number} defaultValue - Default value when the option is absent.
 * @returns {number} Option value.
 */
function readPositiveIntegerOption(values, optionName, defaultValue) {
  const value = values[optionName];
  if (value === undefined) return defaultValue;
  if (typeof value !== "string")
    throw new Error(`--${optionName} must be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer`);
  }
  return parsed;
}

/**
 * Parse CLI options.
 *
 * @returns {ProgressOptions} Parsed progress options.
 */
function parseOptions() {
  const { values } = parseArgs({
    options: {
      bucket: { type: "string" },
      prefix: { type: "string" },
      "start-date": { type: "string" },
      "end-date": { type: "string" },
      "recent-minutes": { type: "string" },
      concurrency: { type: "string" },
      "split-threshold": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    bucket: readStringOption(values, "bucket", DEFAULT_BUCKET),
    prefix: readStringOption(values, "prefix", DEFAULT_PREFIX),
    startDate: readStringOption(values, "start-date", DEFAULT_START_DATE),
    endDate: readStringOption(values, "end-date", DEFAULT_END_DATE),
    recentMinutes: readPositiveIntegerOption(
      values,
      "recent-minutes",
      DEFAULT_RECENT_MINUTES,
    ),
    concurrency: readPositiveIntegerOption(
      values,
      "concurrency",
      DEFAULT_CONCURRENCY,
    ),
    splitThreshold: readPositiveIntegerOption(
      values,
      "split-threshold",
      DEFAULT_SPLIT_THRESHOLD,
    ),
  };
}

/**
 * List all links.json summaries under the permit-list prefix.
 *
 * @param {S3Client} s3 - S3 client.
 * @param {ProgressOptions} options - Progress options.
 * @returns {Promise<ListObjectSummary[]>} List summary object descriptors.
 */
async function listSummaryObjects(s3, options) {
  /** @type {ListObjectSummary[]} */
  const objects = [];
  /** @type {string | undefined} */
  let continuationToken;
  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key?.endsWith("/links.json")) {
        objects.push({
          key: object.Key,
          lastModified: object.LastModified?.toISOString() ?? null,
        });
      }
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

/**
 * Read and enrich one Lee permit list-window summary.
 *
 * @param {S3Client} s3 - S3 client.
 * @param {ProgressOptions} options - Progress options.
 * @param {ListObjectSummary} object - Summary object descriptor.
 * @param {(startDate: string, endDate: string) => number} inclusiveDaySpan - Day span helper.
 * @returns {Promise<EnrichedWindowSummary>} Enriched summary.
 */
async function readWindowSummary(s3, options, object, inclusiveDaySpan) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: options.bucket, Key: object.key }),
  );
  if (!response.Body || typeof response.Body.transformToString !== "function") {
    throw new Error(`S3 body is not readable for ${object.key}`);
  }
  const parsed = /** @type {LeePermitListSummary} */ (
    JSON.parse(await response.Body.transformToString())
  );
  const span = inclusiveDaySpan(parsed.startDate, parsed.endDate);
  const splitRequired =
    parsed.reportedTotal !== null &&
    parsed.reportedTotal >= options.splitThreshold &&
    span > 1;
  return {
    key: object.key,
    lastModified: object.lastModified,
    windowKey: parsed.windowKey,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    span,
    reportedTotal: parsed.reportedTotal,
    discoveredPermitCount: parsed.discoveredPermitCount,
    truncatedForSplit: parsed.truncatedForSplit,
    splitRequired,
    terminal: !splitRequired,
    noResults: parsed.noResults,
  };
}

/**
 * Read all summary objects with bounded concurrency.
 *
 * @param {S3Client} s3 - S3 client.
 * @param {ProgressOptions} options - Progress options.
 * @param {ListObjectSummary[]} objects - Summary object descriptors.
 * @param {(startDate: string, endDate: string) => number} inclusiveDaySpan - Day span helper.
 * @returns {Promise<EnrichedWindowSummary[]>} Enriched summaries.
 */
async function readWindowSummaries(s3, options, objects, inclusiveDaySpan) {
  let cursor = 0;
  /** @type {EnrichedWindowSummary[]} */
  const summaries = [];
  async function worker() {
    while (cursor < objects.length) {
      const object = objects[cursor];
      cursor += 1;
      summaries.push(
        await readWindowSummary(s3, options, object, inclusiveDaySpan),
      );
    }
  }
  await Promise.all(
    Array.from({ length: options.concurrency }, () => worker()),
  );
  return summaries;
}

/**
 * Estimate total list-window nodes required if every covered day must split to one-day terminal windows.
 *
 * @param {number} totalDays - Total days in the overall harvest range.
 * @param {number} initialRootCount - Number of initial root windows.
 * @returns {number} Estimated total binary split-tree nodes.
 */
function estimateTotalSplitTreeNodes(totalDays, initialRootCount) {
  return 2 * totalDays - initialRootCount;
}

/**
 * Main CLI entrypoint.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const options = parseOptions();
  const dayIndex = createDayIndex(options.startDate);
  /**
   * Return the inclusive day span between two YYYY-MM-DD dates.
   *
   * @param {string} startDate - Inclusive start date.
   * @param {string} endDate - Inclusive end date.
   * @returns {number} Inclusive number of days in the date range.
   */
  const inclusiveDaySpan = (startDate, endDate) =>
    dayIndex(endDate) - dayIndex(startDate) + 1;
  const totalDays = inclusiveDaySpan(options.startDate, options.endDate);
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const objects = await listSummaryObjects(s3, options);
  const summaries = await readWindowSummaries(
    s3,
    options,
    objects,
    inclusiveDaySpan,
  );

  const spanCounts = new Map();
  const terminalSpanCounts = new Map();
  const splitRequiredSpanCounts = new Map();
  for (const summary of summaries) {
    spanCounts.set(summary.span, (spanCounts.get(summary.span) ?? 0) + 1);
    const target = summary.terminal
      ? terminalSpanCounts
      : splitRequiredSpanCounts;
    target.set(summary.span, (target.get(summary.span) ?? 0) + 1);
  }

  /** @type {(string | null)[]} */
  const terminalDayTime = Array(totalDays).fill(null);
  for (const summary of summaries.filter((item) => item.terminal)) {
    const start = Math.max(0, dayIndex(summary.startDate));
    const end = Math.min(totalDays - 1, dayIndex(summary.endDate));
    for (let index = start; index <= end; index += 1) {
      const currentLastModified = terminalDayTime[index];
      if (
        !currentLastModified ||
        (summary.lastModified && summary.lastModified < currentLastModified)
      ) {
        terminalDayTime[index] = summary.lastModified;
      }
    }
  }

  const terminalCoveredDays = terminalDayTime.filter(Boolean).length;
  const remainingDays = totalDays - terminalCoveredDays;
  const cutoff = new Date(
    Date.now() - options.recentMinutes * 60_000,
  ).toISOString();
  const writtenInRecentWindow = summaries.filter(
    (summary) => summary.lastModified && summary.lastModified >= cutoff,
  ).length;
  const terminalWrittenInRecentWindow = summaries.filter(
    (summary) =>
      summary.terminal &&
      summary.lastModified &&
      summary.lastModified >= cutoff,
  ).length;
  const splitWrittenInRecentWindow = summaries.filter(
    (summary) =>
      summary.splitRequired &&
      summary.lastModified &&
      summary.lastModified >= cutoff,
  ).length;
  const recentNewTerminalDays = terminalDayTime.filter(
    (value) => value && value >= cutoff,
  ).length;

  const initialRootCount = summaries.filter(
    (summary) =>
      summary.span >= 30 || summary.windowKey === "20260522_20260525",
  ).length;
  const estimatedTotalSplitTreeWindows = estimateTotalSplitTreeNodes(
    totalDays,
    initialRootCount,
  );
  const estimatedRemainingSplitTreeWindows = Math.max(
    0,
    estimatedTotalSplitTreeWindows - summaries.length,
  );
  const estimatedSplitTreeEtaHours =
    writtenInRecentWindow > 0
      ? estimatedRemainingSplitTreeWindows /
        (writtenInRecentWindow / (options.recentMinutes / 60))
      : null;

  let prefixCoveredThrough = null;
  for (let index = 0; index < totalDays; index += 1) {
    if (!terminalDayTime[index]) break;
    prefixCoveredThrough = toDateString(
      addDays(parseDate(options.startDate), index),
    );
  }

  let suffixCoveredFrom = null;
  for (let index = totalDays - 1; index >= 0; index -= 1) {
    if (!terminalDayTime[index]) break;
    suffixCoveredFrom = toDateString(
      addDays(parseDate(options.startDate), index),
    );
  }

  const latestWindows = summaries
    .slice()
    .sort((left, right) =>
      (right.lastModified ?? "").localeCompare(left.lastModified ?? ""),
    )
    .slice(0, 20)
    .map(
      ({
        lastModified,
        windowKey,
        startDate,
        endDate,
        span,
        reportedTotal,
        terminal,
        splitRequired,
      }) => ({
        lastModified,
        windowKey,
        startDate,
        endDate,
        span,
        reportedTotal,
        terminal,
        splitRequired,
      }),
    );

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourcePrefix: `s3://${options.bucket}/${options.prefix}`,
        sourceDateRange: {
          startDate: options.startDate,
          endDate: options.endDate,
          totalDays,
        },
        linksJsonCount: summaries.length,
        spanCounts: sortedNumberMapToObject(spanCounts),
        terminalSpanCounts: sortedNumberMapToObject(terminalSpanCounts),
        splitRequiredSpanCounts: sortedNumberMapToObject(
          splitRequiredSpanCounts,
        ),
        terminalCoveredDays,
        terminalCoveragePercent: Number(
          ((terminalCoveredDays / totalDays) * 100).toFixed(2),
        ),
        remainingDays,
        prefixCoveredThrough,
        suffixCoveredFrom,
        recentMinutes: options.recentMinutes,
        writtenInRecentWindow,
        terminalWrittenInRecentWindow,
        splitWrittenInRecentWindow,
        recentNewTerminalDays,
        estimatedTotalSplitTreeWindows,
        estimatedRemainingSplitTreeWindows,
        estimatedSplitTreeEtaHours,
        latestWindows,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
