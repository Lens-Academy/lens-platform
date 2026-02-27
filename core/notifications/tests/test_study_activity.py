"""Tests for study activity message rendering."""


class TestRenderMessage:
    def test_single_user_in_progress(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 3,
                "sections_total": 8,
                "module_completed": False,
                "early_bird_days": None,
            }
        ]

        result = render_study_activity_message(entries)
        assert "Today's Study Activity" in result
        assert "<@123>" in result
        assert "Cognitive Superpowers" in result
        assert "3/8 sections" in result

    def test_completed_module(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": None,
            }
        ]

        result = render_study_activity_message(entries)
        assert "completed" in result.lower()

    def test_early_bird_tag(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": 4,
            }
        ]

        result = render_study_activity_message(entries)
        assert "early bird" in result.lower()
        assert "4 days" in result

    def test_multiple_users_completed_first(self):
        from core.notifications.study_activity import render_study_activity_message

        entries = [
            {
                "discord_id": "456",
                "display_name": "Bob",
                "module_title": "Decision Theory",
                "sections_completed": 2,
                "sections_total": 5,
                "module_completed": False,
                "early_bird_days": None,
            },
            {
                "discord_id": "123",
                "display_name": "Alice",
                "module_title": "Cognitive Superpowers",
                "sections_completed": 8,
                "sections_total": 8,
                "module_completed": True,
                "early_bird_days": None,
            },
        ]

        result = render_study_activity_message(entries)
        lines = result.strip().split("\n")
        # Find the user lines (skip header)
        user_lines = [line for line in lines if "<@" in line]
        # Completed users should appear before in-progress
        alice_idx = next(i for i, line in enumerate(user_lines) if "Alice" in line)
        bob_idx = next(i for i, line in enumerate(user_lines) if "Bob" in line)
        assert alice_idx < bob_idx, (
            "Completed user (Alice) should appear before in-progress (Bob)"
        )

    def test_empty_entries(self):
        from core.notifications.study_activity import render_study_activity_message

        result = render_study_activity_message([])
        assert result is None
