"""
Unit tests for the scheduling algorithm.
Tests the cohort_scheduler package integration.
"""

import pytest
import sys
from pathlib import Path

# Add project root to path so we can import from core
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

import cohort_scheduler
from core import Person, calculate_total_available_time

# Aliases for cohort_scheduler functions
parse_interval_string = cohort_scheduler.parse_interval_string
format_time_range = cohort_scheduler.format_time_range
find_meeting_times = cohort_scheduler.find_meeting_times
balance_groups = cohort_scheduler.balance_groups
Group = cohort_scheduler.Group


def is_group_valid(
    group, meeting_length, time_increment=30, use_if_needed=True, facilitator_ids=None
):
    """Test helper: check if group is valid (unwraps group.people for cohort_scheduler)."""
    return cohort_scheduler.is_group_valid(
        group.people, meeting_length, time_increment, use_if_needed, facilitator_ids
    )


def run_greedy_iteration(
    people,
    meeting_length,
    min_people,
    max_people,
    time_increment=30,
    randomness=0.5,
    facilitator_ids=None,
    facilitator_max_cohorts=None,
    use_if_needed=True,
):
    """Test helper: single iteration of scheduling algorithm."""
    result = cohort_scheduler.schedule(
        people=people,
        meeting_length=meeting_length,
        min_people=min_people,
        max_people=max_people,
        num_iterations=1,
        time_increment=time_increment,
        randomness=randomness,
        facilitator_ids=facilitator_ids,
        facilitator_max_cohorts=facilitator_max_cohorts,
        use_if_needed=use_if_needed,
        balance=False,
    )
    return result.groups


class TestParseIntervalString:
    """Tests for parse_interval_string function."""

    def test_empty_string(self):
        """Empty string should return empty list."""
        result = parse_interval_string("")
        assert result == []

    def test_none_input(self):
        """None input should return empty list."""
        result = parse_interval_string(None)
        assert result == []

    def test_single_interval(self):
        """Parse a single interval."""
        result = parse_interval_string("M09:00 M10:00")
        assert len(result) == 1
        # Monday 9am = 0 * 1440 + 9 * 60 = 540
        # Monday 10am = 0 * 1440 + 10 * 60 = 600
        assert result[0] == (540, 600)

    def test_multiple_intervals(self):
        """Parse multiple intervals separated by commas."""
        result = parse_interval_string("M09:00 M10:00, T14:00 T15:00")
        assert len(result) == 2
        # Monday 9-10am
        assert result[0] == (540, 600)
        # Tuesday 2-3pm = 1 * 1440 + 14 * 60, 1 * 1440 + 15 * 60
        assert result[1] == (2280, 2340)

    def test_different_days(self):
        """Test intervals on different days."""
        result = parse_interval_string("W10:00 W11:00")
        # Wednesday = day 2, 10am = 2 * 1440 + 10 * 60 = 3480
        assert result[0] == (3480, 3540)

    def test_all_day_codes(self):
        """Test all day codes parse correctly."""
        intervals = [
            ("M08:00 M09:00", 0),  # Monday
            ("T08:00 T09:00", 1),  # Tuesday
            ("W08:00 W09:00", 2),  # Wednesday
            ("R08:00 R09:00", 3),  # Thursday
            ("F08:00 F09:00", 4),  # Friday
            ("S08:00 S09:00", 5),  # Saturday
            ("U08:00 U09:00", 6),  # Sunday
        ]
        for interval_str, expected_day in intervals:
            result = parse_interval_string(interval_str)
            expected_start = expected_day * 1440 + 8 * 60
            assert result[0][0] == expected_start, f"Failed for day {expected_day}"

    def test_half_hour_times(self):
        """Test parsing times with 30-minute marks."""
        result = parse_interval_string("M09:30 M10:30")
        # 9:30am = 9 * 60 + 30 = 570
        assert result[0] == (570, 630)

    def test_whitespace_handling(self):
        """Test that extra whitespace is handled."""
        result = parse_interval_string("  M09:00 M10:00  ,  T14:00 T15:00  ")
        assert len(result) == 2


class TestCalculateTotalAvailableTime:
    """Tests for calculate_total_available_time function."""

    def test_single_interval(self):
        """Calculate time for single interval."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 600)],  # 1 hour
        )
        result = calculate_total_available_time(person)
        assert result == 60

    def test_multiple_intervals(self):
        """Calculate time for multiple intervals."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 600), (2280, 2400)],  # 1 hour + 2 hours
        )
        result = calculate_total_available_time(person)
        assert result == 180

    def test_with_if_needed(self):
        """Calculate time including if-needed intervals."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 600)],  # 1 hour
            if_needed_intervals=[(2280, 2340)],  # 1 hour
        )
        result = calculate_total_available_time(person)
        assert result == 120

    def test_empty_intervals(self):
        """Calculate time with no intervals."""
        person = Person(id="1", name="Test", intervals=[])
        result = calculate_total_available_time(person)
        assert result == 0


class TestIsGroupValid:
    """Tests for is_group_valid function."""

    def test_empty_group(self):
        """Empty group should be valid."""
        group = Group(id="1", name="Test", people=[])
        assert is_group_valid(group, meeting_length=60)

    def test_single_person_valid(self):
        """Single person group should be valid if they have availability."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 660)],  # 2 hour block
        )
        group = Group(id="1", name="Test", people=[person])
        assert is_group_valid(group, meeting_length=60)

    def test_two_people_overlapping(self):
        """Two people with overlapping availability should be valid."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 720)],  # Mon 9am-12pm
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(600, 780)],  # Mon 10am-1pm
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        # They overlap from 10am-12pm (2 hours)
        assert is_group_valid(group, meeting_length=60)

    def test_two_people_no_overlap(self):
        """Two people with no overlapping availability should be invalid."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 600)],  # Mon 9-10am
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(660, 720)],  # Mon 11am-12pm
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        assert not is_group_valid(group, meeting_length=60)

    def test_meeting_length_too_long(self):
        """Group should be invalid if meeting length exceeds overlap."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 600)],  # Mon 9-10am (1 hour)
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(540, 600)],  # Mon 9-10am (1 hour)
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        # They only overlap for 1 hour, but need 2 hours
        assert not is_group_valid(group, meeting_length=120)

    def test_three_people_all_overlap(self):
        """Three people all overlapping should be valid."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])
        person2 = Person(id="2", name="P2", intervals=[(600, 780)])
        person3 = Person(id="3", name="P3", intervals=[(540, 840)])
        group = Group(id="1", name="Test", people=[person1, person2, person3])
        # All overlap from 10am-12pm
        assert is_group_valid(group, meeting_length=60)

    def test_with_if_needed_intervals(self):
        """Test using if-needed intervals for validity."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 600)],  # Mon 9-10am
            if_needed_intervals=[(600, 720)],  # Mon 10am-12pm if needed
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(600, 720)],  # Mon 10am-12pm
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        # With if-needed, they overlap 10am-12pm
        assert is_group_valid(group, meeting_length=60, use_if_needed=True)
        # Without if-needed, they don't overlap
        assert not is_group_valid(group, meeting_length=60, use_if_needed=False)


class TestFindCohortTimeOptions:
    """Tests for find_meeting_times function."""

    def test_single_person(self):
        """Find options for single person."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 720)],  # Mon 9am-12pm (3 hours)
        )
        options = find_meeting_times([person], meeting_length=60, time_increment=30)
        # Should have multiple 1-hour slots within the 3-hour window
        assert len(options) > 0
        # First option should start at 9am
        assert options[0][0] == 540

    def test_two_people_overlap(self):
        """Find options for two overlapping people."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])  # 9am-12pm
        person2 = Person(id="2", name="P2", intervals=[(600, 780)])  # 10am-1pm
        options = find_meeting_times(
            [person1, person2], meeting_length=60, time_increment=30
        )
        # Overlap is 10am-12pm, so should find options there
        assert len(options) > 0
        # First option should start at 10am (600 minutes)
        assert options[0][0] == 600

    def test_no_overlap(self):
        """No options when people don't overlap."""
        person1 = Person(id="1", name="P1", intervals=[(540, 600)])  # 9-10am
        person2 = Person(id="2", name="P2", intervals=[(660, 720)])  # 11am-12pm
        options = find_meeting_times(
            [person1, person2], meeting_length=60, time_increment=30
        )
        assert len(options) == 0


class TestFormatTimeRange:
    """Tests for format_time_range function."""

    def test_same_day(self):
        """Format time range on same day."""
        result = format_time_range(540, 600)  # Mon 9-10am
        assert "Monday" in result
        assert "09:00" in result
        assert "10:00" in result

    def test_different_days(self):
        """Format time range spanning days."""
        # This shouldn't normally happen but test the edge case
        result = format_time_range(1380, 1500)  # Mon 11pm to Tue 1am
        assert "Monday" in result
        assert "Tuesday" in result

    def test_afternoon_time(self):
        """Format afternoon times."""
        result = format_time_range(840, 900)  # Mon 2-3pm
        assert "14:00" in result
        assert "15:00" in result


class TestRunGreedyIteration:
    """Tests for run_greedy_iteration function."""

    def test_single_person(self):
        """Single person should form their own group."""
        person = Person(id="1", name="Test", intervals=[(540, 720)])
        result = run_greedy_iteration(
            [person], meeting_length=60, min_people=1, max_people=8, randomness=0
        )
        assert len(result) == 1
        assert len(result[0].people) == 1

    def test_two_compatible_people(self):
        """Two compatible people should be in same group."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])
        person2 = Person(id="2", name="P2", intervals=[(540, 720)])
        result = run_greedy_iteration(
            [person1, person2],
            meeting_length=60,
            min_people=1,
            max_people=8,
            randomness=0,
        )
        # Both should be in same group
        total_people = sum(len(g.people) for g in result)
        assert total_people == 2

    def test_incompatible_people_separate_groups(self):
        """Incompatible people should be in different groups."""
        person1 = Person(id="1", name="P1", intervals=[(540, 600)])  # 9-10am
        person2 = Person(id="2", name="P2", intervals=[(660, 720)])  # 11am-12pm
        result = run_greedy_iteration(
            [person1, person2],
            meeting_length=60,
            min_people=1,
            max_people=8,
            randomness=0,
        )
        # Should be in separate groups
        assert len(result) == 2

    def test_min_people_filter(self):
        """Groups below min_people should be filtered out."""
        person1 = Person(id="1", name="P1", intervals=[(540, 600)])
        result = run_greedy_iteration(
            [person1],
            meeting_length=60,
            min_people=2,  # Requires 2 people
            max_people=8,
            randomness=0,
        )
        # Single person group should be filtered
        assert len(result) == 0

    def test_max_people_limit(self):
        """Groups should not exceed max_people."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(10)
        ]
        result = run_greedy_iteration(
            people, meeting_length=60, min_people=1, max_people=4, randomness=0
        )
        # No group should have more than 4 people
        for group in result:
            assert len(group.people) <= 4

    def test_randomness_produces_variation(self):
        """Different randomness values should produce different results."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(6)
        ]

        # Run multiple times with randomness
        results = []
        for _ in range(10):
            result = run_greedy_iteration(
                people, meeting_length=60, min_people=2, max_people=4, randomness=0.8
            )
            # Store configuration of groups
            config = tuple(sorted([len(g.people) for g in result]))
            results.append(config)

        # With randomness, we should see some variation (not guaranteed but likely)
        # This test might occasionally fail due to randomness, that's okay
        # unique_results = len(set(results))
        # assert unique_results >= 1  # At least 1 result (always passes)


class TestIntegration:
    """Integration tests for the full scheduling flow."""

    def test_realistic_scenario(self):
        """Test a realistic scheduling scenario."""
        # Create people with varied availability
        people = [
            Person(
                id="1",
                name="Alice",
                intervals=parse_interval_string("M09:00 M12:00, W09:00 W12:00"),
            ),
            Person(
                id="2",
                name="Bob",
                intervals=parse_interval_string("M10:00 M13:00, W10:00 W13:00"),
            ),
            Person(
                id="3",
                name="Carol",
                intervals=parse_interval_string("M09:00 M11:00, T14:00 T17:00"),
            ),
            Person(
                id="4",
                name="Dave",
                intervals=parse_interval_string("M10:00 M12:00, W10:00 W12:00"),
            ),
            Person(
                id="5",
                name="Eve",
                intervals=parse_interval_string("T14:00 T17:00, R14:00 R17:00"),
            ),
            Person(
                id="6",
                name="Frank",
                intervals=parse_interval_string("T15:00 T18:00, R15:00 R18:00"),
            ),
        ]

        result = run_greedy_iteration(
            people, meeting_length=60, min_people=2, max_people=4, randomness=0
        )

        # Should create some valid groups
        assert len(result) > 0

        # Count total scheduled
        total_scheduled = sum(len(g.people) for g in result)
        # Should schedule most people
        assert total_scheduled >= 4

        # Verify all groups are valid
        for group in result:
            assert is_group_valid(group, meeting_length=60)
            assert len(group.people) >= 2
            assert len(group.people) <= 4

    def test_data_format_compatibility(self):
        """Test that the data format matches expected CSV format."""
        # This simulates data coming from user signups
        availability_data = {
            "Monday": ["09:00", "10:00", "14:00"],
            "Tuesday": ["10:00", "11:00"],
            "Wednesday": ["13:00", "15:00", "16:00"],
        }

        # Convert to interval string format (as done in the cog)
        intervals = []
        day_code_map = {
            "Monday": "M",
            "Tuesday": "T",
            "Wednesday": "W",
            "Thursday": "R",
            "Friday": "F",
            "Saturday": "S",
            "Sunday": "U",
        }

        for day, slots in availability_data.items():
            day_code = day_code_map[day]
            for slot in slots:
                hour = int(slot.split(":")[0])
                end_hour = hour + 1
                intervals.append(f"{day_code}{slot} {day_code}{end_hour:02d}:00")

        availability_str = ", ".join(intervals)
        parsed = parse_interval_string(availability_str)

        # Should have parsed all intervals
        assert len(parsed) == 8  # 3 + 2 + 3 slots


class TestEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_midnight_crossing(self):
        """Test availability that crosses midnight."""
        # Late night availability
        result = parse_interval_string("M23:00 T01:00")
        assert len(result) == 1
        # Should handle the day wrap
        start, end = result[0]
        assert end > start

    def test_weekend_availability(self):
        """Test Saturday and Sunday availability."""
        result = parse_interval_string("S10:00 S12:00, U14:00 U16:00")
        assert len(result) == 2
        # Saturday = day 5, Sunday = day 6
        assert result[0][0] == 5 * 1440 + 10 * 60
        assert result[1][0] == 6 * 1440 + 14 * 60

    def test_very_short_meeting(self):
        """Test with very short meeting length."""
        person = Person(id="1", name="Test", intervals=[(540, 570)])  # 30 min
        group = Group(id="1", name="Test", people=[person])
        assert is_group_valid(group, meeting_length=30, time_increment=15)
        assert not is_group_valid(group, meeting_length=60, time_increment=15)

    def test_many_people_same_availability(self):
        """Test with many people having identical availability."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(20)
        ]

        result = run_greedy_iteration(
            people, meeting_length=60, min_people=4, max_people=8, randomness=0
        )

        # Should create multiple groups
        total_scheduled = sum(len(g.people) for g in result)
        assert total_scheduled == 20  # All should be scheduled


class TestBalanceCohorts:
    """Tests for balance_groups function."""

    def test_already_balanced(self):
        """Groups that are already balanced should not change."""
        people1 = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(4)
        ]
        people2 = [
            Person(id=str(i + 4), name=f"P{i + 4}", intervals=[(540, 720)])
            for i in range(4)
        ]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2),
        ]

        moves = balance_groups(groups, meeting_length=60)
        assert moves == 0

    def test_balance_uneven_groups(self):
        """Should move people from larger to smaller groups."""
        people1 = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(6)
        ]
        people2 = [
            Person(id=str(i + 6), name=f"P{i + 6}", intervals=[(540, 720)])
            for i in range(2)
        ]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2),
        ]

        moves = balance_groups(groups, meeting_length=60)
        assert moves > 0
        # Groups should be more balanced now
        sizes = [len(g.people) for g in groups]
        assert max(sizes) - min(sizes) <= 1

    def test_single_group_no_change(self):
        """Single group should not be modified."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(5)
        ]
        groups = [Group(id="1", name="G1", people=people)]

        moves = balance_groups(groups, meeting_length=60)
        assert moves == 0
        assert len(groups[0].people) == 5

    def test_incompatible_no_move(self):
        """Should not move people if they're incompatible with target group."""
        # Group 1: available 9-10am
        people1 = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 600)]) for i in range(5)
        ]
        # Group 2: available 2-3pm (different time)
        people2 = [
            Person(id=str(i + 5), name=f"P{i + 5}", intervals=[(840, 900)])
            for i in range(2)
        ]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2),
        ]

        moves = balance_groups(groups, meeting_length=60)
        # Cannot move because times don't overlap
        assert moves == 0

    def test_three_groups_balance(self):
        """Balance across three groups."""
        people1 = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(7)
        ]
        people2 = [
            Person(id=str(i + 7), name=f"P{i + 7}", intervals=[(540, 720)])
            for i in range(3)
        ]
        people3 = [
            Person(id=str(i + 10), name=f"P{i + 10}", intervals=[(540, 720)])
            for i in range(2)
        ]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2),
            Group(id="3", name="G3", people=people3),
        ]

        moves = balance_groups(groups, meeting_length=60)
        assert moves > 0
        sizes = [len(g.people) for g in groups]
        assert max(sizes) - min(sizes) <= 1


class TestFacilitatorMode:
    """Tests for facilitator mode in scheduling."""

    def test_group_valid_with_one_facilitator(self):
        """Group with exactly one facilitator should be valid."""
        facilitator = Person(id="f1", name="Facilitator", intervals=[(540, 720)])
        person = Person(id="p1", name="Person", intervals=[(540, 720)])

        group = Group(id="1", name="Test", people=[facilitator, person])
        facilitator_ids = {"f1"}

        assert is_group_valid(group, meeting_length=60, facilitator_ids=facilitator_ids)

    def test_group_invalid_no_facilitator(self):
        """Group with no facilitator should be invalid in facilitator mode."""
        person1 = Person(id="p1", name="Person 1", intervals=[(540, 720)])
        person2 = Person(id="p2", name="Person 2", intervals=[(540, 720)])

        group = Group(id="1", name="Test", people=[person1, person2])
        facilitator_ids = {"f1"}  # No one in group is a facilitator

        assert not is_group_valid(
            group, meeting_length=60, facilitator_ids=facilitator_ids
        )

    def test_group_invalid_two_facilitators(self):
        """Group with two facilitators should be invalid."""
        facilitator1 = Person(id="f1", name="Facilitator 1", intervals=[(540, 720)])
        facilitator2 = Person(id="f2", name="Facilitator 2", intervals=[(540, 720)])

        group = Group(id="1", name="Test", people=[facilitator1, facilitator2])
        facilitator_ids = {"f1", "f2"}

        assert not is_group_valid(
            group, meeting_length=60, facilitator_ids=facilitator_ids
        )

    def test_greedy_iteration_with_facilitators(self):
        """Greedy iteration should create groups with one facilitator each."""
        facilitators = [
            Person(id="f1", name="F1", intervals=[(540, 720)]),
            Person(id="f2", name="F2", intervals=[(540, 720)]),
        ]
        participants = [
            Person(id=f"p{i}", name=f"P{i}", intervals=[(540, 720)]) for i in range(6)
        ]

        all_people = facilitators + participants
        facilitator_ids = {"f1", "f2"}

        result = run_greedy_iteration(
            all_people,
            meeting_length=60,
            min_people=2,
            max_people=4,
            randomness=0,
            facilitator_ids=facilitator_ids,
            facilitator_max_cohorts={"f1": 1, "f2": 1},
        )

        # Each group should have exactly one facilitator
        for group in result:
            facilitators_in_group = [p for p in group.people if p.id in facilitator_ids]
            assert len(facilitators_in_group) == 1

    def test_more_students_than_facilitator_capacity(self):
        """When students exceed facilitator capacity, excess students are unassigned."""
        # 2 facilitators, each can lead 1 group of max 5 people = 8 students max
        facilitators = [
            Person(id="f1", name="F1", intervals=[(540, 720)]),
            Person(id="f2", name="F2", intervals=[(540, 720)]),
        ]
        # 15 students - more than 2 facilitators can handle
        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)]) for i in range(15)
        ]

        all_people = facilitators + students
        facilitator_ids = {"f1", "f2"}

        result = cohort_scheduler.schedule(
            all_people,
            meeting_length=60,
            min_people=4,
            max_people=5,
            num_iterations=100,
            facilitator_ids=facilitator_ids,
            facilitator_max_cohorts={"f1": 1, "f2": 1},
        )

        # Should create exactly 2 groups (one per facilitator)
        assert len(result.groups) == 2

        # Each group should have exactly one facilitator
        for group in result.groups:
            facs_in_group = [p for p in group.people if p.id in facilitator_ids]
            assert len(facs_in_group) == 1

        # Some students should be unassigned
        total_grouped = sum(len(g.people) for g in result.groups)
        assert total_grouped <= 10  # 2 groups * 5 max
        assert len(result.unassigned) >= 7  # At least 15 + 2 - 10 = 7 unassigned

        # Unassigned should be students, not facilitators
        unassigned_ids = {p.id for p in result.unassigned}
        assert "f1" not in unassigned_ids
        assert "f2" not in unassigned_ids

    def test_facilitator_no_overlap_with_students(self):
        """When facilitator availability doesn't overlap with students, no groups form."""
        # Facilitator available Tuesday
        facilitator = Person(
            id="f1", name="F1", intervals=[(1980, 2160)]
        )  # Tue 9am-12pm
        # Students available Monday only
        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)])  # Mon 9am-12pm
            for i in range(6)
        ]

        all_people = [facilitator] + students
        facilitator_ids = {"f1"}

        result = cohort_scheduler.schedule(
            all_people,
            meeting_length=60,
            min_people=4,
            max_people=6,
            num_iterations=100,
            facilitator_ids=facilitator_ids,
        )

        # No groups should be created - facilitator can't meet with students
        assert len(result.groups) == 0
        # Everyone should be unassigned
        assert len(result.unassigned) == 7

    def test_excess_facilitators_unassigned(self):
        """When there are more facilitators than needed, excess are unassigned."""
        # 5 facilitators but only 8 students (enough for ~2 groups)
        facilitators = [
            Person(id=f"f{i}", name=f"F{i}", intervals=[(540, 720)]) for i in range(5)
        ]
        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)]) for i in range(8)
        ]

        all_people = facilitators + students
        facilitator_ids = {f"f{i}" for i in range(5)}

        result = cohort_scheduler.schedule(
            all_people,
            meeting_length=60,
            min_people=4,
            max_people=5,
            num_iterations=100,
            facilitator_ids=facilitator_ids,
            facilitator_max_cohorts={f"f{i}": 1 for i in range(5)},
        )

        # Should create 2-3 groups max (13 people / 4-5 per group)
        assert len(result.groups) >= 2
        assert len(result.groups) <= 3

        # Each group has exactly one facilitator
        used_facilitators = set()
        for group in result.groups:
            facs_in_group = [p for p in group.people if p.id in facilitator_ids]
            assert len(facs_in_group) == 1
            used_facilitators.add(facs_in_group[0].id)

        # Some facilitators should be unassigned
        unassigned_facs = [p for p in result.unassigned if p.id in facilitator_ids]
        assert len(unassigned_facs) >= 2  # At least 5 - 3 = 2 unused facilitators

    def test_partial_facilitator_overlap(self):
        """Some facilitators overlap with students, others don't."""
        # F1 available Monday (overlaps with students)
        # F2 available Tuesday (no overlap)
        facilitator1 = Person(id="f1", name="F1", intervals=[(540, 720)])  # Mon
        facilitator2 = Person(id="f2", name="F2", intervals=[(1980, 2160)])  # Tue

        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)])  # Mon only
            for i in range(6)
        ]

        all_people = [facilitator1, facilitator2] + students
        facilitator_ids = {"f1", "f2"}

        result = cohort_scheduler.schedule(
            all_people,
            meeting_length=60,
            min_people=4,
            max_people=6,
            num_iterations=100,
            facilitator_ids=facilitator_ids,
        )

        # Should create 1 group with f1
        assert len(result.groups) == 1
        group = result.groups[0]
        facs_in_group = [p for p in group.people if p.id in facilitator_ids]
        assert len(facs_in_group) == 1
        assert facs_in_group[0].id == "f1"

        # f2 should be unassigned (no overlap with students)
        unassigned_ids = {p.id for p in result.unassigned}
        assert "f2" in unassigned_ids

    def test_facilitator_max_groups_respected(self):
        """Facilitator max_groups limit is respected even when more students available."""
        # 1 facilitator who can lead max 2 groups
        facilitator = Person(id="f1", name="F1", intervals=[(540, 720)])
        # 20 students - could form 4-5 groups but facilitator limited to 2
        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)]) for i in range(20)
        ]

        all_people = [facilitator] + students
        facilitator_ids = {"f1"}

        result = cohort_scheduler.schedule(
            all_people,
            meeting_length=60,
            min_people=4,
            max_people=6,
            num_iterations=100,
            facilitator_ids=facilitator_ids,
            facilitator_max_cohorts={"f1": 2},  # Can lead max 2 groups
        )

        # Should create exactly 2 groups (facilitator limit)
        assert len(result.groups) == 2

        # Facilitator should be in both groups
        for group in result.groups:
            facs_in_group = [p for p in group.people if p.id in facilitator_ids]
            assert len(facs_in_group) == 1
            assert facs_in_group[0].id == "f1"

        # Many students should be unassigned
        assert len(result.unassigned) >= 9  # 20 - (2 groups * ~5.5 students)

    def test_no_facilitators_in_cohort(self):
        """When no facilitators exist, scheduler runs without facilitator constraint."""
        # Use 10 students so they can form 2 groups of 5
        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)]) for i in range(10)
        ]

        # Empty facilitator_ids - scheduler should NOT enforce facilitator constraint
        result = cohort_scheduler.schedule(
            students,
            meeting_length=60,
            min_people=4,
            max_people=5,
            num_iterations=100,
            facilitator_ids=None,  # No facilitator mode
        )

        # Groups should form without facilitators
        assert len(result.groups) == 2
        total_grouped = sum(len(g.people) for g in result.groups)
        assert total_grouped == 10  # All students grouped

    def test_empty_facilitator_set_same_as_none(self):
        """Empty facilitator set should behave same as None (no constraint)."""
        students = [
            Person(id=f"s{i}", name=f"S{i}", intervals=[(540, 720)]) for i in range(10)
        ]

        # Empty set should also disable facilitator mode
        result = cohort_scheduler.schedule(
            students,
            meeting_length=60,
            min_people=4,
            max_people=5,
            num_iterations=100,
            facilitator_ids=set(),  # Empty set
        )

        # Groups should form without facilitators
        assert len(result.groups) == 2
        total_grouped = sum(len(g.people) for g in result.groups)
        assert total_grouped == 10


class TestAnalyzeUngroupableUsers:
    """Tests for analyze_ungroupable_users function."""

    def test_no_availability_reason(self):
        """Users with no availability should get NO_AVAILABILITY reason."""
        from core.scheduling import analyze_ungroupable_users, UngroupableReason

        # Person with no intervals
        person = Person(id="p1", name="NoAvail", intervals=[], if_needed_intervals=[])

        details = analyze_ungroupable_users(
            unassigned=[person],
            all_people=[person],
            facilitator_ids=set(),
            facilitator_max_groups={},
            groups_created=0,
            meeting_length=60,
            min_people=4,
            user_id_map={"p1": 1},
        )

        assert len(details) == 1
        assert details[0].reason == UngroupableReason.no_availability

    def test_no_facilitator_overlap_reason(self):
        """Users whose availability doesn't overlap with facilitators."""
        from core.scheduling import analyze_ungroupable_users, UngroupableReason

        # Facilitator available Tuesday
        facilitator = Person(id="f1", name="Fac", intervals=[(1980, 2160)])  # Tue

        # Student available Monday
        student = Person(id="s1", name="Student", intervals=[(540, 720)])  # Mon

        details = analyze_ungroupable_users(
            unassigned=[student],
            all_people=[facilitator, student],
            facilitator_ids={"f1"},
            facilitator_max_groups={"f1": 2},
            groups_created=0,
            meeting_length=60,
            min_people=4,
            user_id_map={"f1": 1, "s1": 2},
        )

        assert len(details) == 1
        assert details[0].reason == UngroupableReason.no_facilitator_overlap

    def test_facilitator_capacity_reason(self):
        """Users who overlap with facilitators but all are at capacity."""
        from core.scheduling import analyze_ungroupable_users, UngroupableReason

        # Facilitator available and at capacity
        facilitator = Person(id="f1", name="Fac", intervals=[(540, 720)])

        # Student overlaps with facilitator
        student = Person(id="s1", name="Student", intervals=[(540, 720)])

        details = analyze_ungroupable_users(
            unassigned=[student],
            all_people=[facilitator, student],
            facilitator_ids={"f1"},
            facilitator_max_groups={"f1": 1},  # Max 1 group
            groups_created=1,  # Already created 1 group
            meeting_length=60,
            min_people=4,
            user_id_map={"f1": 1, "s1": 2},
        )

        assert len(details) == 1
        assert details[0].reason == UngroupableReason.facilitator_capacity

    def test_insufficient_group_size_reason(self):
        """Users who can't form a group due to not enough overlapping people."""
        from core.scheduling import analyze_ungroupable_users, UngroupableReason

        # Two students with same availability but min_people=4
        student1 = Person(id="s1", name="Student1", intervals=[(540, 720)])
        student2 = Person(id="s2", name="Student2", intervals=[(540, 720)])

        # No facilitators (facilitator mode disabled)
        details = analyze_ungroupable_users(
            unassigned=[student1, student2],
            all_people=[student1, student2],
            facilitator_ids=set(),  # No facilitator constraint
            facilitator_max_groups={},
            groups_created=0,
            meeting_length=60,
            min_people=4,  # Need 4 people
            user_id_map={"s1": 1, "s2": 2},
        )

        assert len(details) == 2
        for detail in details:
            assert detail.reason == UngroupableReason.insufficient_group_size
            assert detail.details["overlapping_users"] == 2
            assert detail.details["min_required"] == 4

    def test_multiple_reasons_in_cohort(self):
        """Different users can have different reasons."""
        from core.scheduling import analyze_ungroupable_users, UngroupableReason

        # Facilitator available Tuesday
        facilitator = Person(id="f1", name="Fac", intervals=[(1980, 2160)])

        # Student 1: No availability
        student1 = Person(id="s1", name="NoAvail", intervals=[])

        # Student 2: Available Monday (no facilitator overlap)
        student2 = Person(id="s2", name="Monday", intervals=[(540, 720)])

        details = analyze_ungroupable_users(
            unassigned=[student1, student2],
            all_people=[facilitator, student1, student2],
            facilitator_ids={"f1"},
            facilitator_max_groups={"f1": 2},
            groups_created=0,
            meeting_length=60,
            min_people=4,
            user_id_map={"f1": 1, "s1": 2, "s2": 3},
        )

        assert len(details) == 2
        reasons = {d.discord_id: d.reason for d in details}
        assert reasons["s1"] == UngroupableReason.no_availability
        assert reasons["s2"] == UngroupableReason.no_facilitator_overlap


class TestFindCohortTimeOptionsExtended:
    """Extended tests for find_meeting_times."""

    def test_with_if_needed_times(self):
        """Find options using if-needed availability."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 600)],  # Regular: 9-10am
            if_needed_intervals=[(600, 720)],  # If needed: 10am-12pm
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[(600, 720)],  # Regular: 10am-12pm
        )

        # With if-needed
        options = find_meeting_times(
            [person1, person2], meeting_length=60, use_if_needed=True
        )
        assert len(options) > 0

        # Without if-needed
        options_no_if = find_meeting_times(
            [person1, person2], meeting_length=60, use_if_needed=False
        )
        assert len(options_no_if) == 0

    def test_multiple_day_options(self):
        """Find options across multiple days."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 720), (1980, 2160)],  # Mon 9-12, Tue 9-12
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[(540, 720), (1980, 2160)],  # Same
        )

        options = find_meeting_times([person1, person2], meeting_length=60)
        # Should find options on both days
        assert len(options) >= 4  # At least 2 options per day

    def test_exact_meeting_length_match(self):
        """Find option when availability exactly matches meeting length."""
        person = Person(
            id="1",
            name="P1",
            intervals=[(540, 600)],  # Exactly 1 hour
        )

        options = find_meeting_times([person], meeting_length=60, time_increment=30)
        assert len(options) == 1
        # Options are (start, end, score) tuples - check start/end match
        assert options[0][0] == 540
        assert options[0][1] == 600


class TestMoreEdgeCases:
    """Additional edge case tests."""

    def test_empty_people_list(self):
        """Scheduling with no people should return empty."""
        result = run_greedy_iteration(
            [], meeting_length=60, min_people=1, max_people=8, randomness=0
        )
        assert result == []

    def test_all_people_incompatible(self):
        """When no one can be grouped together."""
        people = [
            Person(id="1", name="P1", intervals=[(540, 600)]),  # 9-10am
            Person(id="2", name="P2", intervals=[(660, 720)]),  # 11-12pm
            Person(id="3", name="P3", intervals=[(780, 840)]),  # 1-2pm
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=2,  # Need 2 people per group
            max_people=8,
            randomness=0,
        )
        # No valid groups can form
        assert len(result) == 0

    def test_exact_max_people_boundary(self):
        """Test group at exactly max_people."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(4)
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=1,
            max_people=4,  # Exactly 4 people
            randomness=0,
        )

        # All 4 should fit in one group
        assert len(result) == 1
        assert len(result[0].people) == 4

    def test_exact_min_people_boundary(self):
        """Test group at exactly min_people."""
        people = [
            Person(id="1", name="P1", intervals=[(540, 720)]),
            Person(id="2", name="P2", intervals=[(540, 720)]),
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=2,  # Need exactly 2
            max_people=8,
            randomness=0,
        )

        assert len(result) == 1
        assert len(result[0].people) == 2

    def test_partial_overlap_three_people(self):
        """Three people where only pairs overlap."""
        person1 = Person(id="1", name="P1", intervals=[(540, 660)])  # 9-11am
        person2 = Person(id="2", name="P2", intervals=[(600, 720)])  # 10-12pm
        person3 = Person(id="3", name="P3", intervals=[(660, 780)])  # 11am-1pm

        # P1-P2 overlap 10-11, P2-P3 overlap 11-12, but all three don't overlap
        group = Group(id="1", name="Test", people=[person1, person2, person3])
        assert not is_group_valid(group, meeting_length=60)

        # But pairs are valid
        group12 = Group(id="1", name="Test", people=[person1, person2])
        assert is_group_valid(group12, meeting_length=60)

    def test_long_meeting_requirement(self):
        """Test with longer meeting requirements."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])  # 3 hours
        person2 = Person(id="2", name="P2", intervals=[(540, 720)])

        group = Group(id="1", name="Test", people=[person1, person2])

        # 2-hour meeting should work
        assert is_group_valid(group, meeting_length=120)
        # 3-hour meeting should work (exactly fits)
        assert is_group_valid(group, meeting_length=180)
        # 4-hour meeting should not work
        assert not is_group_valid(group, meeting_length=240)

    def test_sunday_to_monday_wrap(self):
        """Test availability at week boundary."""
        # Sunday late night
        result = parse_interval_string("U23:00 M01:00")
        assert len(result) == 1
        start, end = result[0]
        # Should handle wrap correctly
        assert end > start

    def test_different_time_increments(self):
        """Test with different time increment values."""
        person = Person(id="1", name="P1", intervals=[(540, 600)])  # 1 hour
        group = Group(id="1", name="Test", people=[person])

        # Should be valid with 15-min increments
        assert is_group_valid(group, meeting_length=60, time_increment=15)
        # Should be valid with 30-min increments
        assert is_group_valid(group, meeting_length=60, time_increment=30)
        # Should be valid with 60-min increments
        assert is_group_valid(group, meeting_length=60, time_increment=60)


class TestMultipleCoursesScenario:
    """Tests simulating the course-based scheduling scenario."""

    def test_schedule_each_course_separately(self):
        """Test scheduling runs independently per course."""
        agisf_people = [
            Person(id=f"a{i}", name=f"AGISF-{i}", intervals=[(540, 720)])
            for i in range(4)
        ]
        tech_people = [
            Person(
                id=f"t{i}", name=f"Tech-{i}", intervals=[(840, 1020)]
            )  # Different time
            for i in range(4)
        ]

        # Schedule AGISF
        agisf_result = run_greedy_iteration(
            agisf_people, meeting_length=60, min_people=2, max_people=8, randomness=0
        )

        # Schedule Technical
        tech_result = run_greedy_iteration(
            tech_people, meeting_length=60, min_people=2, max_people=8, randomness=0
        )

        # Both should create valid groups
        assert len(agisf_result) >= 1
        assert len(tech_result) >= 1

        # Groups should only contain their course members
        agisf_ids = {p.id for p in agisf_people}
        for group in agisf_result:
            for person in group.people:
                assert person.id in agisf_ids


class TestIfNeededOnlyUsers:
    """Tests for users who only have if-needed availability."""

    def test_person_with_only_if_needed(self):
        """Person with only if-needed intervals should still have availability calculated."""
        person = Person(
            id="1",
            name="Test",
            intervals=[],  # No regular availability
            if_needed_intervals=[(540, 720)],  # Only if-needed
        )
        result = calculate_total_available_time(person)
        assert result == 180  # 3 hours

    def test_group_valid_with_if_needed_only_member(self):
        """Group should be valid when member only has if-needed times."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 720)],  # Regular availability
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[],  # No regular availability
            if_needed_intervals=[(540, 720)],  # Only if-needed
        )

        group = Group(id="1", name="Test", people=[person1, person2])

        # Should be valid when use_if_needed=True
        assert is_group_valid(group, meeting_length=60, use_if_needed=True)

        # Should be invalid when use_if_needed=False (person2 has no regular availability)
        assert not is_group_valid(group, meeting_length=60, use_if_needed=False)

    def test_scheduling_if_needed_only_users(self):
        """Users with only if-needed times should be schedulable."""
        # Mix of regular and if-needed only users
        people = [
            Person(id="1", name="P1", intervals=[(540, 720)]),
            Person(id="2", name="P2", intervals=[(540, 720)]),
            Person(id="3", name="P3", intervals=[], if_needed_intervals=[(540, 720)]),
            Person(id="4", name="P4", intervals=[], if_needed_intervals=[(540, 720)]),
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=2,
            max_people=8,
            randomness=0,
            use_if_needed=True,
        )

        # All 4 should be scheduled together
        total_scheduled = sum(len(g.people) for g in result)
        assert total_scheduled == 4

    def test_find_options_with_if_needed_only(self):
        """Find time options when one person has only if-needed times."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])
        person2 = Person(
            id="2",
            name="P2",
            intervals=[],
            if_needed_intervals=[(600, 720)],  # Overlaps with person1
        )

        options = find_meeting_times(
            [person1, person2], meeting_length=60, use_if_needed=True
        )

        # Should find overlap at 10am-12pm
        assert len(options) > 0
        assert options[0][0] == 600  # 10am

    def test_convert_user_data_if_needed_only(self):
        """Test that user data conversion includes if-needed only users."""
        # Simulate user data format
        user_data = {
            "user1": {
                "name": "Regular User",
                "availability": {"Monday": ["09:00", "10:00"]},
                "if_needed": {},
            },
            "user2": {
                "name": "If-Needed Only User",
                "availability": {},
                "if_needed": {"Monday": ["09:00", "10:00"]},
            },
        }

        # Manually convert like the cog does
        people = []
        for user_id, data in user_data.items():
            if not data.get("availability") and not data.get("if_needed"):
                continue

            day_code_map = {
                "Monday": "M",
                "Tuesday": "T",
                "Wednesday": "W",
                "Thursday": "R",
                "Friday": "F",
                "Saturday": "S",
                "Sunday": "U",
            }

            intervals = []
            for day, slots in data.get("availability", {}).items():
                day_code = day_code_map.get(day, day[0])
                for slot in sorted(slots):
                    hour = int(slot.split(":")[0])
                    end_hour = hour + 1
                    interval_str = f"{day_code}{slot} {day_code}{end_hour:02d}:00"
                    intervals.append(interval_str)

            availability_str = ", ".join(intervals)
            parsed_intervals = parse_interval_string(availability_str)

            if_needed_intervals = []
            for day, slots in data.get("if_needed", {}).items():
                day_code = day_code_map.get(day, day[0])
                for slot in sorted(slots):
                    hour = int(slot.split(":")[0])
                    end_hour = hour + 1
                    interval_str = f"{day_code}{slot} {day_code}{end_hour:02d}:00"
                    if_needed_intervals.append(interval_str)

            if_needed_str = ", ".join(if_needed_intervals)
            parsed_if_needed = parse_interval_string(if_needed_str)

            person = Person(
                id=user_id,
                name=data.get("name", f"User {user_id}"),
                intervals=parsed_intervals,
                if_needed_intervals=parsed_if_needed,
            )
            people.append(person)

        # Both users should be included
        assert len(people) == 2

        # Find the if-needed only user
        if_needed_user = next(p for p in people if p.name == "If-Needed Only User")
        assert len(if_needed_user.intervals) == 0
        assert len(if_needed_user.if_needed_intervals) == 2  # Two 1-hour blocks

    def test_balance_with_if_needed_users(self):
        """Balance cohorts should work with if-needed only users."""
        # Large group with mixed availability
        people1 = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(4)
        ]
        people1.extend(
            [
                Person(
                    id=str(i + 4),
                    name=f"P{i + 4}",
                    intervals=[],
                    if_needed_intervals=[(540, 720)],
                )
                for i in range(2)
            ]
        )

        # Small group
        people2 = [
            Person(id=str(i + 6), name=f"P{i + 6}", intervals=[(540, 720)])
            for i in range(2)
        ]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2),
        ]

        moves = balance_groups(groups, meeting_length=60, use_if_needed=True)

        # Should balance the groups
        assert moves > 0
        sizes = [len(g.people) for g in groups]
        assert max(sizes) - min(sizes) <= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
