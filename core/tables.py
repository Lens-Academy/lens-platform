"""SQLAlchemy Core table definitions for the database schema."""

from sqlalchemy import (
    ARRAY,
    Boolean,
    Column,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Table,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

from .enums import (
    cohort_role_enum,
    cohort_status_enum,
    delivery_method_enum,
    delivery_status_enum,
    dropout_reason_enum,
    group_status_enum,
    group_user_role_enum,
    group_user_status_enum,
    grouping_status_enum,
    rsvp_status_enum,
    ungroupable_reason_enum,
    user_role_enum,
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
    Column("reminder_preferences", JSONB),
    Column("reminder_timing", Text),
    Column("email_notifications_enabled", Boolean, server_default="true"),
    Column("dm_notifications_enabled", Boolean, server_default="true"),
    Column("data_sharing_consent", Boolean, server_default="false"),
    Column("analytics_opt_in", Boolean, server_default="false"),
    Column("public_profile_visible", Boolean, server_default="false"),
    Column("show_in_alumni_directory", Boolean, server_default="false"),
    Column("tos_accepted_at", TIMESTAMP(timezone=True)),
    Column("notes", Text),
    Column("source", Text),
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
    Column("average_rating", Float),
    Column("rating_count", Integer, server_default="0"),
    Column("certified_at", TIMESTAMP(timezone=True)),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_facilitators_user_id", "user_id"),
)


# =====================================================
# 3. ROLES_USERS
# =====================================================
roles_users = Table(
    "roles_users",
    metadata,
    Column("role_user_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("role", user_role_enum),
    Column("granted_at", TIMESTAMP(timezone=True)),
    Column(
        "granted_by_user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
    ),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_roles_users_user_id", "user_id"),
)


# =====================================================
# 4. COURSES
# =====================================================
courses = Table(
    "courses",
    metadata,
    Column("course_id", Integer, primary_key=True, autoincrement=True),
    Column("course_name", Text, nullable=False),
    Column("description", Text),
    Column("duration_days_options", ARRAY(Integer)),
    Column("is_public", Boolean, server_default="true"),
    Column("last_updated_at", TIMESTAMP(timezone=True)),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column(
        "created_by_user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
    ),
)


# =====================================================
# 5. COHORTS
# =====================================================
cohorts = Table(
    "cohorts",
    metadata,
    Column("cohort_id", Integer, primary_key=True, autoincrement=True),
    Column("cohort_name", Text),
    Column(
        "course_id",
        Integer,
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("cohort_start_date", Date, nullable=False),
    Column("duration_days", Integer, nullable=False),
    Column("number_of_group_meetings", Integer, nullable=False),
    Column("discord_category_id", Text),
    Column("status", cohort_status_enum, server_default="active"),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_cohorts_course_id", "course_id"),
    Index("idx_cohorts_start_date", "cohort_start_date"),
)


# =====================================================
# 6. GROUPS
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
    Column("discord_text_channel_id", Text),
    Column("discord_voice_channel_id", Text),
    Column("recurring_meeting_time_utc", Text),
    Column("recurrence_pattern", Text),
    Column("status", group_status_enum, server_default="forming"),
    Column("start_date", Date),
    Column("expected_end_date", Date),
    Column("actual_end_date", Date),
    Column("discord_channel_archived_at", TIMESTAMP(timezone=True)),
    Column("total_messages_in_channel", Integer),
    Column("last_message_at", TIMESTAMP(timezone=True)),
    Column("merged_from_groups", ARRAY(Integer)),
    Column(
        "merged_into_group_id",
        Integer,
        ForeignKey("groups.group_id", ondelete="SET NULL"),
    ),
    Column("max_capacity", Integer, server_default="8"),
    Column("min_size_threshold", Integer, server_default="3"),
    Column("notes", Text),
    Column("flags", JSONB),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column(
        "created_by_user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
    ),
    Index("idx_groups_cohort_id", "cohort_id"),
)


# =====================================================
# 7. GROUPS_USERS
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
    Column("dropout_reason", dropout_reason_enum),
    Column("dropout_details", Text),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_groups_users_user_id", "user_id"),
    Index("idx_groups_users_group_id", "group_id"),
)


# =====================================================
# 8. COURSES_USERS
# =====================================================
courses_users = Table(
    "courses_users",
    metadata,
    Column("course_user_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "course_id",
        Integer,
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "cohort_id",
        Integer,
        ForeignKey("cohorts.cohort_id", ondelete="SET NULL"),
    ),
    Column("role_in_cohort", cohort_role_enum, nullable=False),
    Column("grouping_status", grouping_status_enum, server_default="awaiting_grouping"),
    Column("ungroupable_reason", ungroupable_reason_enum),  # Why user couldn't be grouped (if ungroupable)
    Column("grouping_attempt_count", Integer, server_default="0"),
    Column("last_grouping_attempt_at", TIMESTAMP(timezone=True)),
    Column("is_course_committee_member", Boolean, server_default="false"),
    Column("completed_at", TIMESTAMP(timezone=True)),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_courses_users_user_id", "user_id"),
    Index("idx_courses_users_course_id", "course_id"),
)


# =====================================================
# 9. MEETINGS
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
    Column(
        "course_id",
        Integer,
        ForeignKey("courses.course_id", ondelete="CASCADE"),
    ),
    Column("scheduled_time_utc", TIMESTAMP(timezone=True), nullable=False),
    Column("was_rescheduled", Boolean, server_default="false"),
    Column("reschedule_reason", Text),
    Column("discord_event_id", Text),
    Column("discord_voice_channel_id", Text),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("updated_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Index("idx_meetings_group_id", "group_id"),
    Index("idx_meetings_cohort_id", "cohort_id"),
    Index("idx_meetings_scheduled_time", "scheduled_time_utc"),
)


# =====================================================
# 10. ATTENDANCES
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
# 11. REMINDERS_LOG
# =====================================================
reminders_log = Table(
    "reminders_log",
    metadata,
    Column("reminder_id", Integer, primary_key=True, autoincrement=True),
    Column("message", Text, nullable=False),
    Column("reminder_type", Text, nullable=False),
    Column("sent_at", TIMESTAMP(timezone=True), nullable=False),
    Column("delivery_method", delivery_method_enum, nullable=False),
    Column("delivery_status", delivery_status_enum, server_default="pending"),
    Column("delivery_error", Text),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
)


# =====================================================
# 12. REMINDER_RECIPIENTS_LOG
# =====================================================
reminder_recipients_log = Table(
    "reminder_recipients_log",
    metadata,
    Column("reminder_user_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "reminder_id",
        Integer,
        ForeignKey("reminders_log.reminder_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="SET NULL"),
    ),
    Column(
        "group_id",
        Integer,
        ForeignKey("groups.group_id", ondelete="SET NULL"),
    ),
    Column("created_at", TIMESTAMP(timezone=True), server_default=func.now()),
)


# =====================================================
# 13. AUTH_CODES
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
# 14. LESSON_SESSIONS
# =====================================================
lesson_sessions = Table(
    "lesson_sessions",
    metadata,
    Column("session_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "user_id",
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=True,
    ),
    Column("lesson_id", Text, nullable=False),
    Column("current_stage_index", Integer, server_default="0"),
    Column("messages", JSONB, server_default="[]"),
    Column("started_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("last_active_at", TIMESTAMP(timezone=True), server_default=func.now()),
    Column("completed_at", TIMESTAMP(timezone=True)),
    Index("idx_lesson_sessions_user_id", "user_id"),
    Index("idx_lesson_sessions_lesson_id", "lesson_id"),
)
