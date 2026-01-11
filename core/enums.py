"""SQLAlchemy enum definitions for the database schema."""

import enum

from sqlalchemy import Enum as SQLEnum


# =====================================================
# Python Enum Classes
# =====================================================


class UserRole(str, enum.Enum):
    admin = "admin"
    facilitator = "facilitator"


class CohortStatus(str, enum.Enum):
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class GroupStatus(str, enum.Enum):
    forming = "forming"
    active = "active"
    completed = "completed"
    merged = "merged"
    cancelled = "cancelled"


class GroupUserRole(str, enum.Enum):
    participant = "participant"
    facilitator = "facilitator"


class GroupUserStatus(str, enum.Enum):
    active = "active"
    dropped = "dropped"
    completed = "completed"
    removed = "removed"


class DropoutReason(str, enum.Enum):
    time_constraints = "time_constraints"
    personal_reasons = "personal_reasons"
    course_fit = "course_fit"
    unresponsive = "unresponsive"
    other = "other"


class CohortRole(str, enum.Enum):
    participant = "participant"
    facilitator = "facilitator"


class GroupingStatus(str, enum.Enum):
    awaiting_grouping = "awaiting_grouping"
    grouped = "grouped"
    ungroupable = "ungroupable"


class UngroupableReason(str, enum.Enum):
    """Reasons why a user couldn't be grouped during scheduling."""
    no_availability = "no_availability"  # User has no availability slots
    no_overlap_with_others = "no_overlap_with_others"  # Availability doesn't overlap with enough other users
    no_facilitator_overlap = "no_facilitator_overlap"  # No facilitator available for user's time slots
    facilitator_capacity = "facilitator_capacity"  # Facilitators at max groups, but user has overlap
    insufficient_group_size = "insufficient_group_size"  # Could form group but not enough people


class RSVPStatus(str, enum.Enum):
    pending = "pending"
    attending = "attending"
    not_attending = "not_attending"
    tentative = "tentative"


class DeliveryMethod(str, enum.Enum):
    email = "email"
    discord_dm = "discord_dm"
    discord_channel = "discord_channel"


class DeliveryStatus(str, enum.Enum):
    pending = "pending"
    delivered = "delivered"
    failed = "failed"


# =====================================================
# SQLAlchemy Enum Types
# These reference existing PostgreSQL types (create_type=False)
# =====================================================

user_role_enum = SQLEnum(
    UserRole, name="user_role", create_type=False, native_enum=True
)
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
dropout_reason_enum = SQLEnum(
    DropoutReason, name="dropout_reason", create_type=False, native_enum=True
)
cohort_role_enum = SQLEnum(
    CohortRole, name="cohort_role", create_type=False, native_enum=True
)
grouping_status_enum = SQLEnum(
    GroupingStatus, name="grouping_status", create_type=False, native_enum=True
)
ungroupable_reason_enum = SQLEnum(
    UngroupableReason, name="ungroupable_reason", create_type=False, native_enum=True
)
rsvp_status_enum = SQLEnum(
    RSVPStatus, name="rsvp_status", create_type=False, native_enum=True
)
delivery_method_enum = SQLEnum(
    DeliveryMethod, name="delivery_method", create_type=False, native_enum=True
)
delivery_status_enum = SQLEnum(
    DeliveryStatus, name="delivery_status", create_type=False, native_enum=True
)
