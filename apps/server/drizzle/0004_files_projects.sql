CREATE TYPE "public"."file_kind" AS ENUM('image', 'pdf', 'document', 'presentation', 'spreadsheet', 'text', 'code', 'html', 'ebook', 'data', 'audio', 'video', 'archive', 'url', 'note', 'other');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('uploading', 'queued', 'processing', 'ready', 'failed', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."project_role" AS ENUM('viewer', 'editor', 'owner');--> statement-breakpoint
CREATE TABLE "conversation_files" (
	"conversation_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"message_id" uuid,
	"mode" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector,
	"embedding_model" text,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"kind" "file_kind" NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text,
	"source_url" text,
	"recrawl_hours" integer,
	"last_crawled_at" timestamp with time zone,
	"status" "file_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"text" text,
	"token_count" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"embedded" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'folder' NOT NULL,
	"color" text DEFAULT '#5b4bdb' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"default_model_id" text,
	"default_style_id" text,
	"template_id" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"name" text NOT NULL,
	"declared_mime" text NOT NULL,
	"total_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"part_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_files_unique" ON "conversation_files" USING btree ("conversation_id","file_id");--> statement-breakpoint
CREATE INDEX "file_chunks_file_idx" ON "file_chunks" USING btree ("file_id","ordinal");--> statement-breakpoint
CREATE INDEX "file_chunks_user_idx" ON "file_chunks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_chunks_project_idx" ON "file_chunks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "file_chunks_tsv_idx" ON "file_chunks" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "files_user_idx" ON "files" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "files_project_idx" ON "files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "files_user_sha_idx" ON "files" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "conversations_project_idx" ON "conversations" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
