#!/usr/bin/env node
/**
 * Eevee retrieve CLI (read-only). Returns top-K passages for a query from Eevee's knowledge in
 * soofi-safavi's Persist (`eevee-knowledge` graph), using the same Persist GraphQL `search` calls
 * as agent-eevee's lib/persist-knowledge.ts:
 *   - guidance:  passages linked to knowledge_corpus:eevee:corpus/guidance (books, frameworks, papers)
 *   - thumbnail: passages linked to knowledge_corpus:eevee:corpus/thumbnail-style
 *   - founder:   Soofi Safavi's posts and article segments, linked to author_profile:eevee:author/soofisafavi
 *
 * Usage:
 *   node eevee-retrieve.mjs "<query>" [--top-k N] [--source guidance|thumbnail|founder|both]
 *                                     [--document-type <type>] [--json]
 *
 * Env:
 *   PRISM_API_KEY            soofi-safavi Persist API key; falls back to ~/.config/prism/soofi-safavi.key
 *   PERSIST_API_URL          default https://soofi-safavi.account.prismteam.ai
 *   PERSIST_SEARCH_MODE      SEMANTIC (default), HYBRID or KEYWORD
 *   EEVEE_KNOWLEDGE_BACKEND  `upstash` runs the legacy Vercel path instead: agent-eevee's
 *                            scripts/dist/eevee-retrieve.mjs from the current directory (an agent-eevee
 *                            checkout with `.env.local` from `vercel env pull`).
 *
 * Plain Node 18+ with no dependencies, so it runs in restricted agent sandboxes.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PERSIST_API_URL = "https://soofi-safavi.account.prismteam.ai";
const KEY_FILE = path.join(os.homedir(), ".config", "prism", "soofi-safavi.key");
const REQUEST_TIMEOUT_MS = 15_000;

const CORPUS_IDS = {
  guidance: "knowledge_corpus:eevee:corpus/guidance",
  thumbnail: "knowledge_corpus:eevee:corpus/thumbnail-style",
};
const FOUNDER_AUTHOR_ID = "author_profile:eevee:author/soofisafavi";

/** Eevee `documentType` → Persist `knowledge_document.document_type`. */
const GUIDANCE_DOCUMENT_TYPES = {
  book: "BOOK",
  framework: "FRAMEWORK",
  rfp: "RFP",
  "white-paper-reference": "WHITE_PAPER",
  "lite-paper-reference": "LITEPAPER",
  "light-paper-reference": "LITEPAPER",
  "rfp-strategy": "RFP_RESPONSE_STRATEGY",
  "agent-definition": "AGENT_DEFINITION",
};
/** Eevee thumbnail `documentType` → Persist `style_reference_type` (document_type STYLE_REFERENCE). */
const STYLE_REFERENCE_TYPES = {
  "thumbnail-style-recipe": "RECIPE",
  "thumbnail-style-taxonomy": "TAXONOMY",
  "thumbnail-style-observation": "OBSERVATION",
  "thumbnail-subject-mapping": "SUBJECT_MAPPING",
  "thumbnail-subject-recipe": "SUBJECT_RECIPE",
  "thumbnail-prompt-example": "PROMPT_EXAMPLE",
  "thumbnail-house-style": "HOUSE_STYLE",
  "thumbnail-trend-modifiers": "TREND_MODIFIERS",
  "thumbnail-vision-trends": "VISION_TRENDS",
  "thumbnail-representation-judgment": "REPRESENTATION_JUDGMENT",
};

/** linkedTo takes at most 10 anchors; a larger document set is searched through its corpus and filtered. */
const MAX_LINKED_ANCHORS = 10;
const SEARCH_PAGE_SIZE = 50;
/** Founder candidates per requested hit, so deduplicating segments of one article still fills topK. */
const FOUNDER_CANDIDATES_PER_HIT = 3;

const SOURCES = ["guidance", "thumbnail", "founder", "both"];
const USAGE =
  'Usage: eevee-retrieve "<query>" [--top-k N] [--source guidance|thumbnail|founder|both] [--document-type <type>] [--json]';

function parseArgs(argv) {
  const args = { query: "", topK: 5, json: false, source: "both", documentType: undefined };
  const positional = [];
  const value = (a, i) => (a.includes("=") ? [a.slice(a.indexOf("=") + 1), i] : [argv[i + 1] ?? "", i + 1]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const flag = a.split("=")[0];
    if (a === "--json") args.json = true;
    else if (flag === "--top-k") {
      let raw;
      [raw, i] = value(a, i);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--top-k must be a positive integer");
      args.topK = n;
    } else if (flag === "--source") {
      let raw;
      [raw, i] = value(a, i);
      if (!SOURCES.includes(raw)) throw new Error(`--source must be one of: ${SOURCES.join(", ")}`);
      args.source = raw;
    } else if (flag === "--document-type") {
      let raw;
      [raw, i] = value(a, i);
      if (!GUIDANCE_DOCUMENT_TYPES[raw] && !STYLE_REFERENCE_TYPES[raw]) {
        throw new Error(
          `--document-type must be one of: ${[...Object.keys(GUIDANCE_DOCUMENT_TYPES), ...Object.keys(STYLE_REFERENCE_TYPES)].join(", ")}`,
        );
      }
      args.documentType = raw;
    } else positional.push(a);
  }
  args.query = positional.join(" ").trim();
  if (!args.query) throw new Error(USAGE);
  if (args.documentType) {
    const corpus = STYLE_REFERENCE_TYPES[args.documentType] ? "thumbnail" : "guidance";
    if (args.source === "both") args.source = corpus;
    if (args.source !== corpus) throw new Error(`--document-type ${args.documentType} belongs to --source ${corpus}`);
  }
  return args;
}

function apiKey() {
  const fromEnv = process.env.PRISM_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `No Persist API key. Set PRISM_API_KEY or save the soofi-safavi key to ${KEY_FILE} ` +
      "(ask Saman Safavi; never paste it into a chat). Until then, set EEVEE_KNOWLEDGE_BACKEND=upstash " +
      "to use the legacy Vercel path from an agent-eevee checkout.",
  );
}

async function persistGraphql(query, variables) {
  const key = apiKey();
  const baseUrl = (process.env.PERSIST_API_URL?.trim() || DEFAULT_PERSIST_API_URL).replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/persist/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors?.length || !body.data) {
    const reason = body.errors?.map((e) => e.message).join("; ") || body.error?.message || body.message || `HTTP ${res.status}`;
    throw new Error(`Persist GraphQL failed: ${reason}`);
  }
  return body.data;
}

function searchMode() {
  const mode = process.env.PERSIST_SEARCH_MODE?.trim().toUpperCase();
  return mode === "HYBRID" || mode === "KEYWORD" ? mode : "SEMANTIC";
}

async function searchPage(selection, input) {
  const data = await persistGraphql(
    `query($input: SearchInput!) { search(input: $input) { results { id entity { ${selection} } } pageInfo { hasNextPage endCursor } } }`,
    { input: { mode: searchMode(), ...input } },
  );
  if (!data.search) throw new Error("Persist search returned no result.");
  return data.search;
}

// ---------------------------------------------------------------------------
// Guidance and thumbnail-style passages
// ---------------------------------------------------------------------------

const DOCUMENT_FIELDS = "id title author_display source_reference document_type style_reference_type";
const PASSAGE_SELECTION = `__typename ... on KnowledgePassage { text rev_knowledge_document_has_knowledge_passage(first: 1) { ${DOCUMENT_FIELDS} } }`;

async function corpusDocuments(corpusId) {
  const docs = [];
  for (let offset = 0; ; offset += 100) {
    const data = await persistGraphql(
      `query($id: ID!, $after: String) { knowledge_corpus(id: $id) { knowledge_corpus_has_knowledge_document(first: 100, after: $after) { ${DOCUMENT_FIELDS} } } }`,
      { id: corpusId, after: String(offset) },
    );
    const page = data.knowledge_corpus?.knowledge_corpus_has_knowledge_document ?? [];
    docs.push(...page);
    if (page.length < 100) return docs;
  }
}

function matchesDocumentType(doc, documentType) {
  const style = STYLE_REFERENCE_TYPES[documentType];
  if (style) return doc.document_type === "STYLE_REFERENCE" && doc.style_reference_type === style;
  return doc.document_type === GUIDANCE_DOCUMENT_TYPES[documentType];
}

/** Persist type → the Eevee `documentType` label used in citations. */
function eeveeDocumentType(doc) {
  if (doc.document_type === "STYLE_REFERENCE") {
    return Object.entries(STYLE_REFERENCE_TYPES).find(([, v]) => v === doc.style_reference_type)?.[0] ?? "";
  }
  const guidance = Object.entries(GUIDANCE_DOCUMENT_TYPES).find(([, v]) => v === doc.document_type);
  return guidance?.[0] ?? doc.document_type?.toLowerCase().replace(/_/g, "-") ?? "";
}

/** Top passages of one corpus, optionally narrowed to one Eevee documentType. */
async function retrievePassages({ query, topK, corpus, documentType }) {
  const corpusId = CORPUS_IDS[corpus];
  let anchors = [corpusId];
  let keepDocument = null;
  if (documentType) {
    const docs = (await corpusDocuments(corpusId)).filter((d) => matchesDocumentType(d, documentType));
    if (docs.length === 0) return [];
    if (docs.length <= MAX_LINKED_ANCHORS) {
      anchors = docs.map((d) => d.id);
    } else {
      const ids = new Set(docs.map((d) => d.id));
      keepDocument = (doc) => ids.has(doc.id);
    }
  }

  const hits = [];
  let after;
  do {
    const page = await searchPage(PASSAGE_SELECTION, {
      query,
      first: keepDocument ? SEARCH_PAGE_SIZE : Math.min(topK, SEARCH_PAGE_SIZE),
      ownerLabels: ["knowledge_passage"],
      linkedTo: { ids: anchors },
      ...(after ? { after } : {}),
    });
    for (const r of page.results) {
      const doc = r.entity?.rev_knowledge_document_has_knowledge_passage?.[0];
      if (!r.entity?.text?.trim() || !doc || (keepDocument && !keepDocument(doc))) continue;
      hits.push({
        id: r.id.replace(/^eevee:passage\//, ""),
        content: r.entity.text,
        source: corpus,
        metadata: {
          documentId: doc.id.replace(/^eevee:document\//, ""),
          title: doc.title ?? "",
          author: doc.author_display ?? "",
          source: doc.source_reference ?? "",
          documentType: eeveeDocumentType(doc),
          category: doc.document_type === "STYLE_REFERENCE" ? "thumbnail-style" : "guidance",
        },
      });
      if (hits.length >= topK) return hits;
    }
    after = keepDocument && page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? undefined) : undefined;
  } while (after);
  return hits;
}

// ---------------------------------------------------------------------------
// Founder posts and article segments
// ---------------------------------------------------------------------------

// body_blob_key is String on one type and String! on the other, so each needs its own alias.
const FOUNDER_SELECTION =
  "__typename ... on SocialPost { id text title source_uri postBlobKey: body_blob_key } " +
  "... on ArticleSegment { id text segmentBlobKey: body_blob_key rev_article_has_article_segment(first: 1) { id title source_uri } }";

const normalize = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * One hit per post or article, at the rank of its best segment. An article's hit uses its best-ranked
 * segment that holds more than the title; a title-only segment is used only when no fuller one was found.
 */
function uniqueFounderHitsByArticle(results, topK) {
  const hits = new Map();
  for (const { entity } of results) {
    if (!entity?.text) continue;
    if (entity.__typename === "SocialPost") {
      if (hits.has(entity.id)) continue;
      hits.set(entity.id, {
        title: entity.title ?? "",
        content: entity.text,
        sourceUri: entity.source_uri ?? "",
        contentType: "post",
        blobKey: entity.postBlobKey ?? "",
        titleOnly: false,
      });
      continue;
    }
    const article = entity.rev_article_has_article_segment?.[0];
    const key = article?.id ?? entity.id;
    const titleOnly = Boolean(article?.title) && normalize(entity.text) === normalize(article?.title ?? "");
    const seen = hits.get(key);
    if (seen && !(seen.titleOnly && !titleOnly)) continue;
    // Map.set on an existing key keeps its position, so a fuller segment keeps the article's rank.
    hits.set(key, {
      title: article?.title ?? "",
      content: entity.text,
      sourceUri: article?.source_uri ?? "",
      contentType: "article",
      blobKey: entity.segmentBlobKey ?? "",
      titleOnly,
    });
  }
  return [...hits.values()].slice(0, topK);
}

async function searchFounder({ query, topK }) {
  const page = await searchPage(FOUNDER_SELECTION, {
    query,
    first: Math.min(topK * FOUNDER_CANDIDATES_PER_HIT, SEARCH_PAGE_SIZE),
    ownerLabels: ["social_post", "article_segment"],
    linkedTo: { ids: [FOUNDER_AUTHOR_ID] },
  });
  return uniqueFounderHitsByArticle(page.results, topK).map((h) => ({
    id: h.sourceUri || h.title,
    content: h.content,
    source: "founder",
    metadata: { title: h.title, sourceUri: h.sourceUri, contentType: h.contentType, blobKey: h.blobKey },
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Persist returns a ranking, not scores, so two lists merge by alternating rank. */
function mergeByRank(a, b, topK) {
  const merged = [];
  for (let i = 0; merged.length < topK && i < Math.max(a.length, b.length); i++) {
    if (a[i]) merged.push(a[i]);
    if (b[i] && merged.length < topK) merged.push(b[i]);
  }
  return merged;
}

function formatResults(results, json) {
  if (json) return JSON.stringify(results, null, 2);
  if (results.length === 0) return "No passages found in Eevee's knowledge for that query.";
  return results
    .map((r, i) => {
      const name = r.metadata.title || r.metadata.source || r.metadata.sourceUri || "(unknown source)";
      return `#${i + 1} [${r.source}] ${name} (id: ${r.id})\n${r.content}\n`;
    })
    .join("\n");
}

/** EEVEE_KNOWLEDGE_BACKEND=upstash: run agent-eevee's own CLI on the legacy Upstash + Vercel Blob path. */
function runLegacyVercelPath(argv) {
  const cli = path.resolve("scripts/dist/eevee-retrieve.mjs");
  if (!fs.existsSync(cli)) {
    console.error(
      `EEVEE_KNOWLEDGE_BACKEND=upstash needs an agent-eevee checkout as the current directory, with ${cli} ` +
        "(run `npm install`) and `.env.local` (run `vercel env pull .env.local`).",
    );
    return 1;
  }
  const res = spawnSync(process.execPath, [cli, ...argv], {
    stdio: "inherit",
    env: { ...process.env, EEVEE_KNOWLEDGE_BACKEND: "upstash" },
  });
  return res.status ?? 1;
}

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (process.env.EEVEE_KNOWLEDGE_BACKEND?.trim().toLowerCase() === "upstash") {
    if (args.documentType || args.source === "thumbnail") {
      console.error("--document-type and --source thumbnail need the Persist backend.");
      return 2;
    }
    return runLegacyVercelPath(argv);
  }

  const { query, topK, json, source, documentType } = args;
  try {
    let results;
    if (source === "both") {
      const [guidance, founder] = await Promise.all([
        retrievePassages({ query, topK, corpus: "guidance" }),
        searchFounder({ query, topK }),
      ]);
      results = mergeByRank(guidance, founder, topK);
    } else if (source === "founder") {
      results = await searchFounder({ query, topK });
    } else {
      results = await retrievePassages({ query, topK, corpus: source, documentType });
    }
    console.log(formatResults(results, json));
    return 0;
  } catch (err) {
    console.error(`Eevee retrieve failed: ${err.message}`);
    return 1;
  }
}

process.exitCode = await main();
