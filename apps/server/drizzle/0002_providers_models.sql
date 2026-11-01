CREATE TYPE "public"."health_status" AS ENUM('unknown', 'healthy', 'degraded', 'down');--> statement-breakpoint
CREATE TYPE "public"."model_visibility" AS ENUM('everyone', 'verified', 'admins', 'beta');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('openai', 'anthropic', 'gemini', 'ollama', 'cohere', 'mistral', 'openrouter', 'vllm', 'lmstudio', 'custom');--> statement-breakpoint
CREATE TABLE "model_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"model_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"provider_model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_key" text,
	"context_window" integer DEFAULT 8192 NOT NULL,
	"max_output_tokens" integer DEFAULT 4096 NOT NULL,
	"capabilities" jsonb NOT NULL,
	"pricing" jsonb,
	"system_prompt_prefix" text DEFAULT '' NOT NULL,
	"default_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"visibility" "model_visibility" DEFAULT 'everyone' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"rpm_limit" integer,
	"daily_token_cap" integer,
	"fallback_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deprecation_date" date,
	"deprecation_message" text,
	"replacement_model_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"label" text DEFAULT 'Primary' NOT NULL,
	"key_enc" text NOT NULL,
	"key_preview" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"monthly_spend_cap_usd" numeric(12, 4),
	"spent_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"spend_month" text,
	"cooldown_until" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "provider_type" NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon_key" text,
	"base_url" text NOT NULL,
	"headers_enc" text,
	"organization" text,
	"project" text,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"max_retries" integer DEFAULT 2 NOT NULL,
	"region" text,
	"allow_private_network" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"health_status" "health_status" DEFAULT 'unknown' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_latency_ms" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "beta_tester" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_aliases" ADD CONSTRAINT "model_aliases_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "models_provider_model_unique" ON "models" USING btree ("provider_id","provider_model_id");--> statement-breakpoint
CREATE INDEX "models_enabled_idx" ON "models" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "provider_keys_provider_idx" ON "provider_keys" USING btree ("provider_id");