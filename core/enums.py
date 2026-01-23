"""SQLAlchemy enum definitions for the database schema."""

import enum

from sqlalchemy import Enum as SQLEnum


# =====================================================
# Python Enum Classes
# =====================================================


class CohortStatus(str, enum.Enum):
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class GroupStatus(str, enum.Enum):
    preview = "preview"
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class GroupUserRole(str, enum.Enum):
    participant = "participant"
    facilitator = "facilitator"


class GroupUserStatus(str, enum.Enum):
    active = "active"
    dropped = "dropped"
    completed = "completed"
    removed = "removed"


class CohortRole(str, enum.Enum):
    participant = "participant"
    facilitator = "facilitator"


class UngroupableReason(str, enum.Enum):
    """Reasons why a user couldn't be grouped during scheduling."""

    no_availability = "no_availability"  # User has no availability slots
    no_overlap_with_others = (
        "no_overlap_with_others"  # Availability doesn't overlap with enough other users
    )
    no_facilitator_overlap = (
        "no_facilitator_overlap"  # No facilitator available for user's time slots
    )
    facilitator_capacity = (
        "facilitator_capacity"  # Facilitators at max groups, but user has overlap
    )
    insufficient_group_size = (
        "insufficient_group_size"  # Could form group but not enough people
    )


class RSVPStatus(str, enum.Enum):
    pending = "pending"
    attending = "attending"
    not_attending = "not_attending"
    tentative = "tentative"


class StageType(str, enum.Enum):
    article = "article"
    video = "video"
    chat = "chat"


class ContentEventType(str, enum.Enum):
    heartbeat = "heartbeat"
    start = "start"
    complete = "complete"


class NotificationReferenceType(str, enum.Enum):
    """Types of entities that notifications can reference."""

    group_id = "group_id"
    meeting_id = "meeting_id"
    cohort_id = "cohort_id"
    user_id = "user_id"


# =====================================================
# SQLAlchemy Enum Types
# These reference existing PostgreSQL types (create_type=False)
# =====================================================

cohort_status_enum = SQLEnum(
    CohortStatus, name="cohort_status", create_type=False, native_enum=True
)
group_status_enum = SQLEnum(
    GroupStatus, name="group_status", create_type=False, native_enum=True
)
group_user_role_enum = SQLEnum(
    GroupUserRole, name="group_user_role", create_type=False, native_enum=True
)
group_user_status_enum = SQLEnum(
    GroupUserStatus, name="group_user_status", create_type=False, native_enum=True
)
cohort_role_enum = SQLEnum(
    CohortRole, name="cohort_role", create_type=False, native_enum=True
)
ungroupable_reason_enum = SQLEnum(
    UngroupableReason, name="ungroupable_reason", create_type=False, native_enum=True
)
rsvp_status_enum = SQLEnum(
    RSVPStatus, name="rsvp_status", create_type=False, native_enum=True
)
notification_reference_type_enum = SQLEnum(
    NotificationReferenceType,
    name="notification_reference_type",
    create_type=False,
    native_enum=True,
)
