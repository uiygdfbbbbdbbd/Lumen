ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_project_id_projects_id_fk;
DROP INDEX IF EXISTS conversations_project_idx;
ALTER TABLE conversations DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS conversation_files, upload_sessions, file_chunks, files, project_members, projects CASCADE;
DROP TYPE IF EXISTS file_status, file_kind, project_role;
