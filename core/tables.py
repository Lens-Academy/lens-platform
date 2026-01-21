"""SQLAlchemy Core table definitions for the database schema."""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

from sqlalchemy import Enum as SQLEnum

from .enums import (
    ContentEventType,
    StageType,
    cohort_role_enum,
    cohort_status_enum,
    group_status_enum,
    group_user_role_enum,
    group_user_status_enum,
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
    Column("recurring_meeting_time_utc", Text),
    Column("status", group_status_enum, server_default="preview"),
    Column("start_date", Date),
    Column("expected_end_date", Date),
    Column("actual_end_date", Date),
    Column("discord_channel_archived_at", TIMESTAMP(timezone=True)),
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
    Column("google_calendar_event_id", Text),
    Column("calendar_invite_sent_at", TIMESTAMP(timezone=True)),
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
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_attendances_meeting_id", "meeting_id"),
    Index("idx_attendances_user_id", "user_id"),
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
    Index("idx_notification_log_user_id", "user_id"),
    Index("idx_notification_log_sent_at", "sent_at"),
)


# =====================================================
# 10. AUTH_CODES
# =====================================================
auth_codes = Table(
    "auth_codes",
    metadata,
    Column("code_id", Integer, primary_key=True, autoincrement=True),
    Column("code", Text, nullable=False, unique=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False),
    Column("used_at", TIMESTAMP(timezone=True)),
    Column("discord_id", Text),
    Index("idx_auth_codes_code", "code"),
    Index("idx_auth_codes_user_id", "user_id"),
)


# =====================================================
# 11. MODULE_SESSIONS
# =====================================================
module_sessions = Table(
    "module_sessions",
    metadata,
    Column("session_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("module_slug", Text, nullable=False),
    Column("current_stage_index", Integer, server_default="0"),
    Column("messages", JSONB, server_default="[]"),
    Column("started_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("last_active_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("completed_at", TIMESTAMP(timezone=True)),
    Index("idx_module_sessions_user_id", "user_id"),
    Index("idx_module_sessions_module_slug", "module_slug"),
)


# =====================================================
# 12. CONTENT_EVENTS
# =====================================================
content_events = Table(
    "content_events",
    metadata,
    Column("event_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,  # Anonymous sessions allowed
    ),
    Column(
        "session_id",
        Integer,
        ForeignKey("module_sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("module_slug", Text, nullable=False),
    Column("stage_index", Integer, nullable=False),
    Column(
        "stage_type",
        SQLEnum(StageType, name="stage_type_enum", create_type=True),
        nullable=False,
    ),
    Column(
        "event_type",
        SQLEnum(ContentEventType, name="content_event_type_enum", create_type=True),
        nullable=False,
    ),
    Column("timestamp", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("metadata", JSONB, nullable=True),  # scroll_depth, video_time, etc.
    Index("idx_content_events_user_id", "user_id"),
    Index("idx_content_events_session_id", "session_id"),
    Index("idx_content_events_module_slug", "module_slug"),
    Index("idx_content_events_timestamp", "timestamp"),
)
