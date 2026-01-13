-- Add Google Calendar and meeting number fields to meetings table
ALTER TABLE meetings
ADD COLUMN IF NOT EXISTS meeting_number INTEGER,
ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT,
ADD COLUMN IF NOT EXISTS calendar_invite_sent_at TIMESTAMP WITH TIME ZONE;

-- Index for Google Calendar event lookup
CREATE INDEX IF NOT EXISTS idx_meetings_google_event
ON meetings(google_calendar_event_id)
WHERE google_calendar_event_id IS NOT NULL;

-- Add unique constraint for meeting/user in attendances (for upsert)
ALTER TABLE attendances
ADD CONSTRAINT IF NOT EXISTS attendances_meeting_user_unique
UNIQUE (meeting_id, user_id);
