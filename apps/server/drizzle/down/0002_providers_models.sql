DROP TABLE IF EXISTS model_aliases, models, provider_keys, providers CASCADE;
DROP TYPE IF EXISTS provider_type, health_status, model_visibility;
ALTER TABLE users DROP COLUMN IF EXISTS preferences, DROP COLUMN IF EXISTS beta_tester;
