-- Add number_of_group_meetings and discord_category_id to cohorts table
-- Run manually: psql $DATABASE_URL -f migrations/add_cohort_columns.sql

ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS number_of_group_meetings INTEGER;
ALTER TABLE cohorts ADD COLUMN IF NOT EXISTS discord_category_id TEXT;

-- For existing cohorts, set a default (can be updated later)
UPDATE cohorts SET number_of_group_meetings = 8 WHERE number_of_group_meetings IS NULL;

-- Now make it NOT NULL
ALTER TABLE cohorts ALTER COLUMN number_of_group_meetings SET NOT NULL;
