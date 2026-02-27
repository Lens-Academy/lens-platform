"""SQLAlchemy Core table definitions for the database schema."""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID

from .enums import (
    cohort_role_enum,
    cohort_status_enum,
    group_status_enum,
    group_user_role_enum,
    group_user_status_enum,
    notification_reference_type_enum,
    rsvp_status_enum,
    ungroupable_reason_enum,
)

# Naming convention for constraints (helps Alembic generate better names)
convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
metadata = MetaData(naming_convention=convention)


# =====================================================
# 1. USERS
# =====================================================
users = Table(
    "users",
    metadata,
    Column("user_id", Integer, primary_key=True, autoincrement=True),
    Column("discord_id", Text),
    Column("discord_username", Text),
    Column("discord_avatar", Text),  # Avatar hash from Discord API
    Column("nickname", Text),
    Column("email", Text),
    Column("email_verified_at", TIMESTAMP(timezone=True)),
    Column("last_active_at", TIMESTAMP(timezone=True)),
    Column("timezone", Text),
    Column("availability_local", Text),
    Column("if_needed_availability_local", Text),
    Column("availability_last_updated_at", TIMESTAMP(timezone=True)),
    Column("email_notifications_enabled", Boolean, server_default="true"),
    Column("dm_notifications_enabled", Boolean, server_default="true"),
    Column("is_admin", Boolean, server_default="false"),
    Column("tos_accepted_at", TIMESTAMP(timezone=True)),
    Column("cookies_analytics_consent", Text),  # 'accepted' | 'declined' | NULL
    Column("cookies_analytics_consent_at", TIMESTAMP(timezone=True)),
    CheckConstraint(
        "cookies_analytics_consent IN ('accepted', 'declined')",
        name="valid_cookies_analytics_consent",
    ),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("deleted_at", TIMESTAMP(timezone=True)),
    Index("idx_users_discord_id", "discord_id"),
    Index("idx_users_email", "email"),
)


# =====================================================
# 2. FACILITATORS
# =====================================================
facilitators = Table(
    "facilitators",
    metadata,
    Column("facilitator_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("max_active_groups", Integer, server_default="2"),
    Column("certified_at", TIMESTAMP(timezone=True)),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_facilitators_user_id", "user_id"),
)


# =====================================================
# 3. COHORTS
# =====================================================
# Course content loaded from YAML by slug - no courses table needed
cohorts = Table(
    "cohorts",
    metadata,
    Column("cohort_id", Integer, primary_key=True, autoincrement=True),
    Column("cohort_name", Text),
    Column("course_slug", Text, nullable=False),  # references YAML course slug
    Column("cohort_start_date", Date, nullable=False),
    Column("duration_days", Integer, nullable=False),
    Column("number_of_group_meetings", Integer, nullable=False),
    Column("discord_category_id", Text),
    Column("discord_cohort_channel_id", Text),
    Column("status", cohort_status_enum, server_default="active"),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_cohorts_course_slug", "course_slug"),
    Index("idx_cohorts_start_date", "cohort_start_date"),
)


# =====================================================
# 4. GROUPS
# =====================================================
groups = Table(
    "groups",
    metadata,
    Column("group_id", Integer, primary_key=True, autoincrement=True),
    Column("group_name", Text, nullable=False),
    Column(
        "cohort_id",
        Integer,
        ForeignKey("cohorts.cohort_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "course_slug_override", Text
    ),  # NULL = use cohort's course_slug, set = A/B test variant
    Column("discord_category_id", Text),
    Column("discord_text_channel_id", Text),
    Column("discord_voice_channel_id", Text),
    Column("discord_role_id", Text),
    Column("recurring_meeting_time_utc", Text),
    Column("status", group_status_enum, server_default="preview"),
    Column("start_date", Date),
    Column("expected_end_date", Date),
    Column("actual_end_date", Date),
    Column("discord_channel_archived_at", TIMESTAMP(timezone=True)),
    Column("gcal_recurring_event_id", Text),
    Column("calendar_invite_sent_at", TIMESTAMP(timezone=True)),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_groups_cohort_id", "cohort_id"),
)


# =====================================================
# 5. GROUPS_USERS
# =====================================================
groups_users = Table(
    "groups_users",
    metadata,
    Column("group_user_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "group_id",
        Integer,
        ForeignKey("groups.group_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("role", group_user_role_enum, nullable=False),
    Column("status", group_user_status_enum, server_default="active"),
    Column("joined_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("left_at", TIMESTAMP(timezone=True)),
    Column("completed_at", TIMESTAMP(timezone=True)),
    Column("reason_for_leaving", Text),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_groups_users_user_id", "user_id"),
    Index("idx_groups_users_group_id", "group_id"),
)


# =====================================================
# 6. SIGNUPS
# =====================================================
signups = Table(
    "signups",
    metadata,
    Column("signup_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "cohort_id",
        Integer,
        ForeignKey("cohorts.cohort_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("role", cohort_role_enum, nullable=False),
    Column("ungroupable_reason", ungroupable_reason_enum),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_signups_user_id", "user_id"),
    Index("idx_signups_cohort_id", "cohort_id"),
    UniqueConstraint("user_id", "cohort_id", name="uq_signups_user_id_cohort_id"),
)


# =====================================================
# 7. MEETINGS
# =====================================================
meetings = Table(
    "meetings",
    metadata,
    Column("meeting_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "group_id",
        Integer,
        ForeignKey("groups.group_id", ondelete="CASCADE"),
    ),
    Column(
        "cohort_id",
        Integer,
        ForeignKey("cohorts.cohort_id", ondelete="CASCADE"),
    ),
    Column("scheduled_at", TIMESTAMP(timezone=True), nullable=False),
    Column("meeting_number", Integer),
    Column("discord_event_id", Text),
    Column("discord_voice_channel_id", Text),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_meetings_group_id", "group_id"),
    Index("idx_meetings_cohort_id", "cohort_id"),
    Index("idx_meetings_scheduled_at", "scheduled_at"),
)


# =====================================================
# 8. ATTENDANCES
# =====================================================
attendances = Table(
    "attendances",
    metadata,
    Column("attendance_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "meeting_id",
        Integer,
        ForeignKey("meetings.meeting_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("rsvp_status", rsvp_status_enum, server_default="pending"),
    Column("rsvp_at", TIMESTAMP(timezone=True)),
    Column("checked_in_at", TIMESTAMP(timezone=True)),
    Column("is_guest", Boolean, server_default=text("false"), nullable=False),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_attendances_meeting_id", "meeting_id"),
    Index("idx_attendances_user_id", "user_id"),
    UniqueConstraint("meeting_id", "user_id", name="attendances_meeting_user_unique"),
)


# =====================================================
# 9. NOTIFICATION_LOG
# =====================================================
notification_log = Table(
    "notification_log",
    metadata,
    Column("log_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
    ),
    Column("channel_id", Text),  # Discord channel ID (for channel messages)
    Column(
        "message_type", Text, nullable=False
    ),  # e.g., "welcome", "meeting_reminder_24h"
    Column("channel", Text, nullable=False),  # "email", "discord_dm", "discord_channel"
    Column("status", Text, nullable=False),  # "sent", "failed"
    Column("error_message", Text),  # Why it failed (if applicable)
    Column("sent_at", TIMESTAMP(timezone=True), server_default=func.now()),
    # New columns for notification deduplication
    Column("reference_type", notification_reference_type_enum),
    Column("reference_id", Integer),
    Index("idx_notification_log_user_id", "user_id"),
    Index("idx_notification_log_sent_at", "sent_at"),
    # New index for deduplication queries
    Index(
        "idx_notification_log_dedup",
        "user_id",
        "message_type",
        "reference_type",
        "reference_id",
    ),
)


# =====================================================
# 10. REFRESH_TOKENS
# =====================================================
refresh_tokens = Table(
    "refresh_tokens",
    metadata,
    Column("token_id", Integer, primary_key=True, autoincrement=True),
    Column("token_hash", Text, nullable=False, unique=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("family_id", Text, nullable=False),  # UUID grouping a rotation chain
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False),
    Column("revoked_at", TIMESTAMP(timezone=True)),  # NULL = active
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_refresh_tokens_user_id", "user_id"),
    Index("idx_refresh_tokens_family_id", "family_id"),
)


# =====================================================
# 11. USER_CONTENT_PROGRESS
# =====================================================
# Progress tracking - new UUID-based system
user_content_progress = Table(
    "user_content_progress",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("anonymous_token", UUID(as_uuid=True), nullable=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("content_id", UUID(as_uuid=True), nullable=False),
    Column("content_type", Text, nullable=False),
    Column("content_title", Text, nullable=False),
    Column(
        "started_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column("time_to_complete_s", Integer, server_default="0", nullable=False),
    Column("total_time_spent_s", Integer, server_default="0", nullable=False),
    Column("last_heartbeat_at", DateTime(timezone=True), nullable=True),
    Column("completed_at", DateTime(timezone=True), nullable=True),
    Index(
        "idx_user_content_progress_user",
        "user_id",
        "content_id",
        unique=True,
        postgresql_where=text("user_id IS NOT NULL"),
    ),
    Index(
        "idx_user_content_progress_anon",
        "anonymous_token",
        "content_id",
        unique=True,
        postgresql_where=text("anonymous_token IS NOT NULL"),
    ),
    Index(
        "idx_user_content_progress_token",
        "anonymous_token",
        postgresql_where=text("anonymous_token IS NOT NULL"),
    ),
    CheckConstraint(
        "content_type IN ('module', 'lo', 'lens', 'test')", name="valid_content_type"
    ),
)


# =====================================================
# 12. CHAT_SESSIONS
# =====================================================
chat_sessions = Table(
    "chat_sessions",
    metadata,
    Column("session_id", Integer, primary_key=True, autoincrement=True),
    Column("anonymous_token", UUID(as_uuid=True), nullable=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("content_id", UUID(as_uuid=True), nullable=True),
    Column("content_type", Text, nullable=True),
    Column("messages", JSONB, server_default="[]", nullable=False),
    Column(
        "started_at", DateTime(timezone=True), server_default=func.now(), nullable=False
    ),
    Column(
        "last_active_at",
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    ),
    Column("archived_at", DateTime(timezone=True), nullable=True),
    Index("idx_chat_sessions_user_content", "user_id", "content_id", "archived_at"),
    Index("idx_chat_sessions_token", "anonymous_token"),
    # Unique partial indexes to prevent duplicate active sessions (race condition fix)
    Index(
        "idx_chat_sessions_unique_anon_active",
        "anonymous_token",
        "content_id",
        unique=True,
        postgresql_where=text("anonymous_token IS NOT NULL AND archived_at IS NULL"),
    ),
    Index(
        "idx_chat_sessions_unique_user_active",
        "user_id",
        "content_id",
        unique=True,
        postgresql_where=text("user_id IS NOT NULL AND archived_at IS NULL"),
    ),
    CheckConstraint(
        "content_type IS NULL OR content_type IN ('module', 'lo', 'lens', 'test', 'feedback')",
        name="valid_chat_content_type",
    ),
)


# =====================================================
# 13. QUESTION_RESPONSES
# =====================================================
question_responses = Table(
    "question_responses",
    metadata,
    Column("response_id", Integer, primary_key=True, autoincrement=True),
    Column("anonymous_token", UUID(as_uuid=True), nullable=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    # What was answered
    Column("question_id", Text, nullable=False),  # Content-derived ID (from markdown)
    Column("module_slug", Text, nullable=False),  # Which module
    Column(
        "question_text", Text, nullable=False
    ),  # Snapshot of question shown to student
    Column(
        "assessment_instructions", Text, nullable=True
    ),  # Scoring rubric from content markdown (assessment-instructions:: field)
    Column(
        "question_hash", Text, nullable=False
    ),  # SHA-256 of question_text for analysis
    # The answer
    Column("answer_text", Text, nullable=False),
    Column(
        "answer_metadata", JSONB, server_default="{}", nullable=False
    ),  # voice_used, time_taken_s, etc.
    # Timestamps
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("completed_at", TIMESTAMP(timezone=True), nullable=True),
    # Indexes
    Index("idx_question_responses_user_id", "user_id"),
    Index("idx_question_responses_anon", "anonymous_token"),
    Index("idx_question_responses_question", "question_id"),
    Index("idx_question_responses_module", "module_slug"),
    Index("idx_question_responses_hash", "question_hash"),
)


# =====================================================
# 14. QUESTION_ASSESSMENTS
# =====================================================
question_assessments = Table(
    "question_assessments",
    metadata,
    Column("score_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "response_id",
        Integer,
        ForeignKey("question_responses.response_id", ondelete="CASCADE"),
        nullable=False,
    ),
    # Score data
    Column("score_data", JSONB, nullable=False),  # Flexible AI assessment results
    Column("model_id", Text, nullable=True),  # Which LLM model scored this
    Column(
        "assessment_system_prompt_version", Text, nullable=True
    ),  # Version of the scoring system prompt in core/scoring.py
    # Timestamps
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    # Indexes
    Index("idx_question_assessments_response_id", "response_id"),
)
