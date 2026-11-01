ALTER TYPE "public"."provider_type" ADD VALUE 'stability';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE 'replicate';--> statement-breakpoint
ALTER TYPE "public"."provider_type" ADD VALUE 'comfyui';--> statement-breakpoint
CREATE TABLE "generated_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"prompt" text NOT NULL,
	"revised_prompt" text,
	"negative_prompt" text,
	"aspect_ratio" text DEFAULT '1:1' NOT NULL,
	"model_id" uuid,
	"model_name" text,
	"seed" integer,
	"variation_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_images_user_idx" ON "generated_images" USING btree ("user_id","created_at");