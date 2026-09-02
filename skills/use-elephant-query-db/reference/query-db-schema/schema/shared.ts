import { sql } from "drizzle-orm";
import { jsonb, text, timestamp } from "drizzle-orm/pg-core";

export type JsonObject = Record<string, unknown>;

export const emptyJsonObject = sql`'{}'::jsonb`;
export const emptyTextArray = sql`ARRAY[]::text[]`;

export function jsonObjectColumn(name: string) {
  return jsonb(name).$type<JsonObject>().notNull().default(emptyJsonObject);
}

export function nullableJsonObjectColumn(name: string) {
  return jsonb(name).$type<JsonObject>();
}

export function createdAtColumn() {
  return timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
}

export function updatedAtColumn() {
  return timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
}

export function loadedAtColumn() {
  return timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow();
}

export function sourceMetadataColumns() {
  return {
    sourceSystem: text("source_system").notNull(),
    sourceRecordKey: text("source_record_key").notNull(),
    sourceRecordHash: text("source_record_hash"),
    sourceArtifactUri: text("source_artifact_uri"),
    loadedAt: loadedAtColumn(),
  };
}
