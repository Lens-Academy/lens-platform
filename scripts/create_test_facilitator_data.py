#!/usr/bin/env python
"""
Create test data for facilitator panel testing.

Creates:
- 1 course, 1 cohort
- 2 groups with 5 users each
- Realistic lesson progress (heartbeats)
- Lorem ipsum chat history

Run: python scripts/create_test_facilitator_data.py
Delete: python scripts/delete_test_facilitator_data.py
"""

import asyncio
import random
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv('.env.local')

from sqlalchemy import insert, text
from core.database import get_connection
from core.tables import (
    users, courses, cohorts, groups, groups_users,
    lesson_sessions, content_events,
)
from core.enums import ContentEventType

# Test data prefix for easy cleanup
PREFIX = "fac_test_"

# Fake user data
FAKE_USERS = [
    # Group 1: "Alignment Alpacas"
    {"name": "Alice Anderson", "progress": "high"},
    {"name": "Bob Baker", "progress": "medium"},
    {"name": "Carol Chen", "progress": "low"},
    {"name": "David Davis", "progress": "high"},
    {"name": "Emma Evans", "progress": "none"},
    # Group 2: "Safety Sloths"
    {"name": "Frank Foster", "progress": "medium"},
    {"name": "Grace Garcia", "progress": "high"},
    {"name": "Henry Harris", "progress": "low"},
    {"name": "Ivy Ibrahim", "progress": "medium"},
    {"name": "Jack Johnson", "progress": "high"},
]

# Lorem ipsum chat messages
LOREM_CHATS = [
    [
        {"role": "user", "content": "I'm confused about mesa-optimization. Can you explain it simply?"},
        {"role": "assistant", "content": "Of course! Mesa-optimization occurs when a learned model itself becomes an optimizer. Think of it like training a student who develops their own goals that might differ from what you intended to teach them."},
        {"role": "user", "content": "So it's like the AI developing its own agenda?"},
        {"role": "assistant", "content": "That's a good intuition! More precisely, it's when the AI's internal optimization process pursues objectives that weren't explicitly specified in training. This can lead to unexpected behaviors."},
    ],
    [
        {"role": "user", "content": "What's the difference between AI safety and AI alignment?"},
        {"role": "assistant", "content": "Great question! AI safety is the broader field concerned with preventing AI systems from causing harm. AI alignment is specifically about ensuring AI systems pursue the goals we actually want them to pursue."},
        {"role": "user", "content": "So alignment is a subset of safety?"},
        {"role": "assistant", "content": "Exactly! Alignment is one crucial component of safety. You could have a well-aligned AI that still has safety issues (like being hacked), or safety measures that don't address alignment."},
        {"role": "user", "content": "That makes sense. What are the main approaches to alignment?"},
        {"role": "assistant", "content": "The main approaches include RLHF (learning from human feedback), constitutional AI, interpretability research, and formal verification methods. Each tackles the problem from a different angle."},
    ],
    [
        {"role": "user", "content": "I read about Goodhart's Law. How does it apply to AI?"},
        {"role": "assistant", "content": "Goodhart's Law states that when a measure becomes a target, it ceases to be a good measure. In AI, this means optimizing for a proxy metric can lead to behaviors that game the metric without achieving the true goal."},
        {"role": "user", "content": "Can you give an example?"},
        {"role": "assistant", "content": "Sure! Imagine training an AI to maximize user engagement. It might learn to show increasingly extreme content because that keeps people clicking, even though that wasn't the intended outcome."},
    ],
    [
        {"role": "user", "content": "What is instrumental convergence?"},
        {"role": "assistant", "content": "Instrumental convergence refers to the idea that many different final goals lead to similar intermediate goals. For example, almost any goal benefits from self-preservation, resource acquisition, and goal-content integrity."},
        {"role": "user", "content": "Why is that concerning for AI safety?"},
        {"role": "assistant", "content": "It's concerning because even a seemingly benign goal could lead an AI to resist being shut down (self-preservation) or accumulate resources, simply because these help achieve almost any objective."},
    ],
]

LESSON_IDS = ["intro-to-ai-safety", "mesa-optimization", "alignment-basics", "instrumental-convergence"]


async def create_test_data():
    """Create all test data."""
    async with get_connection() as conn:
        print("Creating test data for facilitator panel...")

        # 1. Create course
        course_result = await conn.execute(
            insert(courses).values(
                course_name=f"{PREFIX}AI Safety Fundamentals",
                description="Test course for facilitator panel",
            ).returning(courses)
        )
        course = dict(course_result.mappings().first())
        print(f"  Created course: {course['course_name']} (id={course['course_id']})")

        # 2. Create cohort
        cohort_result = await conn.execute(
            insert(cohorts).values(
                cohort_name=f"{PREFIX}January 2025 Cohort",
                course_id=course["course_id"],
                cohort_start_date=datetime.now(timezone.utc).date() - timedelta(days=14),
                duration_days=56,
                number_of_group_meetings=8,
                status="active",
            ).returning(cohorts)
        )
        cohort = dict(cohort_result.mappings().first())
        print(f"  Created cohort: {cohort['cohort_name']} (id={cohort['cohort_id']})")

        # 3. Create groups
        group1_result = await conn.execute(
            insert(groups).values(
                cohort_id=cohort["cohort_id"],
                group_name=f"{PREFIX}Alignment Alpacas",
                status="active",
            ).returning(groups)
        )
        group1 = dict(group1_result.mappings().first())

        group2_result = await conn.execute(
            insert(groups).values(
                cohort_id=cohort["cohort_id"],
                group_name=f"{PREFIX}Safety Sloths",
                status="active",
            ).returning(groups)
        )
        group2 = dict(group2_result.mappings().first())
        print(f"  Created groups: {group1['group_name']}, {group2['group_name']}")

        # 4. Create users and add to groups
        created_users = []
        for i, fake_user in enumerate(FAKE_USERS):
            user_result = await conn.execute(
                insert(users).values(
                    discord_id=f"{PREFIX}discord_{i}",
                    discord_username=f"{PREFIX}{fake_user['name'].lower().replace(' ', '_')}",
                    nickname=fake_user["name"],
                ).returning(users)
            )
            user = dict(user_result.mappings().first())
            user["progress"] = fake_user["progress"]
            created_users.append(user)

            # Add to appropriate group
            group_id = group1["group_id"] if i < 5 else group2["group_id"]
            await conn.execute(
                insert(groups_users).values(
                    user_id=user["user_id"],
                    group_id=group_id,
                    role="participant",
                    status="active",
                )
            )

        print(f"  Created {len(created_users)} users")

        # 5. Create lesson progress for each user
        for user in created_users:
            await create_user_progress(conn, user)

        print("  Created lesson sessions, heartbeats, and chat history")

        await conn.commit()
        print("\nTest data created successfully!")
        print(f"\nTo view: http://localhost:5174/facilitator")
        print(f"To delete: python scripts/delete_test_facilitator_data.py")


async def create_user_progress(conn, user):
    """Create realistic lesson progress for a user."""
    progress_level = user["progress"]

    if progress_level == "none":
        return  # No progress

    # Determine how many lessons to complete
    if progress_level == "high":
        num_lessons = random.randint(3, 4)
        heartbeats_per_stage = random.randint(8, 15)
    elif progress_level == "medium":
        num_lessons = random.randint(2, 3)
        heartbeats_per_stage = random.randint(5, 10)
    else:  # low
        num_lessons = 1
        heartbeats_per_stage = random.randint(2, 5)

    lessons_to_create = LESSON_IDS[:num_lessons]

    for lesson_idx, lesson_id in enumerate(lessons_to_create):
        is_completed = lesson_idx < num_lessons - 1  # Last one might be in progress

        # Create lesson session with chat
        chat_messages = random.choice(LOREM_CHATS) if random.random() > 0.3 else []

        session_result = await conn.execute(
            insert(lesson_sessions).values(
                user_id=user["user_id"],
                lesson_id=lesson_id,
                current_stage_index=2 if is_completed else random.randint(0, 2),
                messages=chat_messages,
                started_at=datetime.now(timezone.utc) - timedelta(days=random.randint(1, 10)),
                completed_at=datetime.now(timezone.utc) - timedelta(days=random.randint(0, 5)) if is_completed else None,
            ).returning(lesson_sessions)
        )
        session = dict(session_result.mappings().first())

        # Create heartbeats for each stage
        stages = [
            ("article", 0),
            ("video", 1),
            ("chat", 2),
        ]

        for stage_type, stage_index in stages:
            if not is_completed and stage_index > session["current_stage_index"]:
                continue  # Don't create heartbeats for future stages

            num_heartbeats = heartbeats_per_stage + random.randint(-2, 2)
            for _ in range(max(1, num_heartbeats)):
                await conn.execute(
                    insert(content_events).values(
                        user_id=user["user_id"],
                        session_id=session["session_id"],
                        lesson_id=lesson_id,
                        stage_index=stage_index,
                        stage_type=stage_type,
                        event_type=ContentEventType.heartbeat,
                        timestamp=datetime.now(timezone.utc) - timedelta(
                            days=random.randint(0, 7),
                            hours=random.randint(0, 23),
                            minutes=random.randint(0, 59),
                        ),
                        metadata={"scroll_depth": random.random()} if stage_type == "article" else None,
                    )
                )


if __name__ == "__main__":
    asyncio.run(create_test_data())
