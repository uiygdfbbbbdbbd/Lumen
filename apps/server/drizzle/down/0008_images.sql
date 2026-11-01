-- Roll back 0008_images. Postgres can't drop enum values: providers using the new types must be removed first.
DROP TABLE IF EXISTS "generated_images";
DELETE FROM "providers" WHERE "type"::text IN ('stability', 'replicate', 'comfyui');
ALTER TYPE "public"."provider_type" RENAME TO "provider_type_old";
CREATE TYPE "public"."provider_type" AS ENUM('openai', 'anthropic', 'gemini', 'ollama', 'cohere', 'mistral', 'openrouter', 'vllm', 'lmstudio', 'custom');
ALTER TABLE "providers" ALTER COLUMN "type" TYPE "public"."provider_type" USING "type"::text::"public"."provider_type";
DROP TYPE "public"."provider_type_old";
