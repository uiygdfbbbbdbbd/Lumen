-- Roll back 0006_memory
DROP TABLE IF EXISTS "memory_summaries";
DROP TABLE IF EXISTS "memories";
DROP TYPE IF EXISTS "public"."memory_source";
DROP TYPE IF EXISTS "public"."memory_category";
