-- Remove calendar columns from meetings table (now tracked at group level)
-- Clean break - no legacy support needed

ALTER TABLE meetings DROP COLUMN IF EXISTS google_calendar_event_id;
ALTER TABLE meetings DROP COLUMN IF EXISTS calendar_invite_sent_at;
