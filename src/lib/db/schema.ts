import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const works = sqliteTable("works", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastPracticedAt: text("last_practiced_at"),
  currentKey: text("current_key").notNull(),
  manualKeyOverride: integer("manual_key_override", {
    mode: "boolean",
  }).notNull().default(false),
  lastPositionPageIndex: integer("last_position_page_index"),
  lastPositionObjectId: text("last_position_object_id"),
  lastPositionMeasure: integer("last_position_measure"),
  status: text("status").notNull().default("draft"),
});

export const workPages = sqliteTable("work_pages", {
  id: text("id").primaryKey(),
  workId: text("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  pageIndex: integer("page_index").notNull(),
  imagePath: text("image_path").notNull(),
  musicXmlPath: text("music_xml_path"),
  sourceFileRef: text("source_file_ref").notNull(),
  recognitionStatus: text("recognition_status").notNull().default("queued"),
  recognizedAt: text("recognized_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recognitionResults = sqliteTable("recognition_results", {
  id: text("id").primaryKey(),
  workPageId: text("work_page_id")
    .notNull()
    .references(() => workPages.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(),
  version: text("version").notNull(),
  rawResponse: text("raw_response").notNull(),
  normalizedData: text("normalized_data").notNull(),
  confidenceMin: real("confidence_min").notNull(),
  confidenceMax: real("confidence_max").notNull(),
  confidenceAverage: real("confidence_average").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_recognition_results_work_page").on(table.workPageId),
]);

export const scoreObjects = sqliteTable("score_objects", {
  id: text("id").primaryKey(),
  workPageId: text("work_page_id")
    .notNull()
    .references(() => workPages.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  bboxJson: text("bbox_json").notNull(),
  staff: text("staff").notNull(),
  measure: integer("measure").notNull(),
  onset: real("onset"),
  notesJson: text("notes_json").notNull(),
  confidence: real("confidence").notNull(),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_score_objects_work_page").on(table.workPageId),
]);

export const practiceStates = sqliteTable("practice_states", {
  id: text("id").primaryKey(),
  workId: text("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  lastPageIndex: integer("last_page_index").notNull().default(0),
  lastObjectId: text("last_object_id"),
  lastMeasure: integer("last_measure"),
  instrumentMode: text("instrument_mode").notNull().default("piano"),
  guitarViewMode: text("guitar_view_mode").notNull().default("recommended"),
  updatedAt: text("updated_at").notNull(),
});

export const workRelations = relations(works, ({ many, one }) => ({
  pages: many(workPages),
  practiceState: one(practiceStates, {
    fields: [works.id],
    references: [practiceStates.workId],
  }),
}));

export const workPageRelations = relations(workPages, ({ one, many }) => ({
  work: one(works, {
    fields: [workPages.workId],
    references: [works.id],
  }),
  recognitionResults: many(recognitionResults),
  scoreObjects: many(scoreObjects),
}));

export const recognitionResultRelations = relations(
  recognitionResults,
  ({ one }) => ({
    page: one(workPages, {
      fields: [recognitionResults.workPageId],
      references: [workPages.id],
    }),
  }),
);

export const scoreObjectRelations = relations(scoreObjects, ({ one }) => ({
  page: one(workPages, {
    fields: [scoreObjects.workPageId],
    references: [workPages.id],
  }),
}));

export const practiceStateRelations = relations(practiceStates, ({ one }) => ({
  work: one(works, {
    fields: [practiceStates.workId],
    references: [works.id],
  }),
}));
