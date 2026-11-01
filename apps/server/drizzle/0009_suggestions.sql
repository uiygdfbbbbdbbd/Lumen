CREATE TYPE "public"."artifact_suggestion_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "artifact_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"base_version" integer NOT NULL,
	"content" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"status" "artifact_suggestion_status" DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifact_suggestions" ADD CONSTRAINT "artifact_suggestions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_suggestions" ADD CONSTRAINT "artifact_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_suggestions_artifact_idx" ON "artifact_suggestions" USING btree ("artifact_id","status");