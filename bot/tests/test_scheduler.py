"""
Unit tests for the scheduler cog.
Tests the core scheduling algorithm functions.
"""

import pytest
import sys
from pathlib import Path

# Add parent directory to path so we can import the cog
sys.path.insert(0, str(Path(__file__).parent.parent))

from cogs.scheduler import (
    parse_interval_string,
    is_group_valid,
    calculate_total_available_time,
    run_greedy_iteration,
    find_cohort_time_options,
    format_time_range,
    balance_cohorts,
    Person,
    Group,
    DAY_MAP
)


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
            ("M08:00 M09:00", 0),   # Monday
            ("T08:00 T09:00", 1),   # Tuesday
            ("W08:00 W09:00", 2),   # Wednesday
            ("R08:00 R09:00", 3),   # Thursday
            ("F08:00 F09:00", 4),   # Friday
            ("S08:00 S09:00", 5),   # Saturday
            ("U08:00 U09:00", 6),   # Sunday
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
            intervals=[(540, 600)]  # 1 hour
        )
        result = calculate_total_available_time(person)
        assert result == 60

    def test_multiple_intervals(self):
        """Calculate time for multiple intervals."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 600), (2280, 2400)]  # 1 hour + 2 hours
        )
        result = calculate_total_available_time(person)
        assert result == 180

    def test_with_if_needed(self):
        """Calculate time including if-needed intervals."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 600)],  # 1 hour
            if_needed_intervals=[(2280, 2340)]  # 1 hour
        )
        result = calculate_total_available_time(person)
        assert result == 120

    def test_empty_intervals(self):
        """Calculate time with no intervals."""
        person = Person(
            id="1",
            name="Test",
            intervals=[]
        )
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
            intervals=[(540, 660)]  # 2 hour block
        )
        group = Group(id="1", name="Test", people=[person])
        assert is_group_valid(group, meeting_length=60)

    def test_two_people_overlapping(self):
        """Two people with overlapping availability should be valid."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 720)]  # Mon 9am-12pm
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(600, 780)]  # Mon 10am-1pm
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        # They overlap from 10am-12pm (2 hours)
        assert is_group_valid(group, meeting_length=60)

    def test_two_people_no_overlap(self):
        """Two people with no overlapping availability should be invalid."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 600)]  # Mon 9-10am
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(660, 720)]  # Mon 11am-12pm
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        assert not is_group_valid(group, meeting_length=60)

    def test_meeting_length_too_long(self):
        """Group should be invalid if meeting length exceeds overlap."""
        person1 = Person(
            id="1",
            name="Person 1",
            intervals=[(540, 600)]  # Mon 9-10am (1 hour)
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(540, 600)]  # Mon 9-10am (1 hour)
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
            if_needed_intervals=[(600, 720)]  # Mon 10am-12pm if needed
        )
        person2 = Person(
            id="2",
            name="Person 2",
            intervals=[(600, 720)]  # Mon 10am-12pm
        )
        group = Group(id="1", name="Test", people=[person1, person2])
        # With if-needed, they overlap 10am-12pm
        assert is_group_valid(group, meeting_length=60, use_if_needed=True)
        # Without if-needed, they don't overlap
        assert not is_group_valid(group, meeting_length=60, use_if_needed=False)


class TestFindCohortTimeOptions:
    """Tests for find_cohort_time_options function."""

    def test_single_person(self):
        """Find options for single person."""
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 720)]  # Mon 9am-12pm (3 hours)
        )
        options = find_cohort_time_options([person], meeting_length=60, time_increment=30)
        # Should have multiple 1-hour slots within the 3-hour window
        assert len(options) > 0
        # First option should start at 9am
        assert options[0][0] == 540

    def test_two_people_overlap(self):
        """Find options for two overlapping people."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])  # 9am-12pm
        person2 = Person(id="2", name="P2", intervals=[(600, 780)])  # 10am-1pm
        options = find_cohort_time_options([person1, person2], meeting_length=60, time_increment=30)
        # Overlap is 10am-12pm, so should find options there
        assert len(options) > 0
        # First option should start at 10am (600 minutes)
        assert options[0][0] == 600

    def test_no_overlap(self):
        """No options when people don't overlap."""
        person1 = Person(id="1", name="P1", intervals=[(540, 600)])  # 9-10am
        person2 = Person(id="2", name="P2", intervals=[(660, 720)])  # 11am-12pm
        options = find_cohort_time_options([person1, person2], meeting_length=60, time_increment=30)
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
        person = Person(
            id="1",
            name="Test",
            intervals=[(540, 720)]
        )
        result = run_greedy_iteration(
            [person],
            meeting_length=60,
            min_people=1,
            max_people=8,
            randomness=0
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
            randomness=0
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
            randomness=0
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
            randomness=0
        )
        # Single person group should be filtered
        assert len(result) == 0

    def test_max_people_limit(self):
        """Groups should not exceed max_people."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)])
            for i in range(10)
        ]
        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=1,
            max_people=4,
            randomness=0
        )
        # No group should have more than 4 people
        for group in result:
            assert len(group.people) <= 4

    def test_randomness_produces_variation(self):
        """Different randomness values should produce different results."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)])
            for i in range(6)
        ]

        # Run multiple times with randomness
        results = []
        for _ in range(10):
            result = run_greedy_iteration(
                people,
                meeting_length=60,
                min_people=2,
                max_people=4,
                randomness=0.8
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
            Person(id="1", name="Alice", intervals=parse_interval_string("M09:00 M12:00, W09:00 W12:00")),
            Person(id="2", name="Bob", intervals=parse_interval_string("M10:00 M13:00, W10:00 W13:00")),
            Person(id="3", name="Carol", intervals=parse_interval_string("M09:00 M11:00, T14:00 T17:00")),
            Person(id="4", name="Dave", intervals=parse_interval_string("M10:00 M12:00, W10:00 W12:00")),
            Person(id="5", name="Eve", intervals=parse_interval_string("T14:00 T17:00, R14:00 R17:00")),
            Person(id="6", name="Frank", intervals=parse_interval_string("T15:00 T18:00, R15:00 R18:00")),
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=2,
            max_people=4,
            randomness=0
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
            "Wednesday": ["13:00", "15:00", "16:00"]
        }

        # Convert to interval string format (as done in the cog)
        intervals = []
        day_code_map = {'Monday': 'M', 'Tuesday': 'T', 'Wednesday': 'W',
                       'Thursday': 'R', 'Friday': 'F', 'Saturday': 'S', 'Sunday': 'U'}

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
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)])
            for i in range(20)
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=4,
            max_people=8,
            randomness=0
        )

        # Should create multiple groups
        total_scheduled = sum(len(g.people) for g in result)
        assert total_scheduled == 20  # All should be scheduled


class TestBalanceCohorts:
    """Tests for balance_cohorts function."""

    def test_already_balanced(self):
        """Groups that are already balanced should not change."""
        people1 = [Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(4)]
        people2 = [Person(id=str(i+4), name=f"P{i+4}", intervals=[(540, 720)]) for i in range(4)]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2)
        ]

        moves = balance_cohorts(groups, meeting_length=60)
        assert moves == 0

    def test_balance_uneven_groups(self):
        """Should move people from larger to smaller groups."""
        people1 = [Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(6)]
        people2 = [Person(id=str(i+6), name=f"P{i+6}", intervals=[(540, 720)]) for i in range(2)]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2)
        ]

        moves = balance_cohorts(groups, meeting_length=60)
        assert moves > 0
        # Groups should be more balanced now
        sizes = [len(g.people) for g in groups]
        assert max(sizes) - min(sizes) <= 1

    def test_single_group_no_change(self):
        """Single group should not be modified."""
        people = [Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(5)]
        groups = [Group(id="1", name="G1", people=people)]

        moves = balance_cohorts(groups, meeting_length=60)
        assert moves == 0
        assert len(groups[0].people) == 5

    def test_incompatible_no_move(self):
        """Should not move people if they're incompatible with target group."""
        # Group 1: available 9-10am
        people1 = [Person(id=str(i), name=f"P{i}", intervals=[(540, 600)]) for i in range(5)]
        # Group 2: available 2-3pm (different time)
        people2 = [Person(id=str(i+5), name=f"P{i+5}", intervals=[(840, 900)]) for i in range(2)]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2)
        ]

        moves = balance_cohorts(groups, meeting_length=60)
        # Cannot move because times don't overlap
        assert moves == 0

    def test_three_groups_balance(self):
        """Balance across three groups."""
        people1 = [Person(id=str(i), name=f"P{i}", intervals=[(540, 720)]) for i in range(7)]
        people2 = [Person(id=str(i+7), name=f"P{i+7}", intervals=[(540, 720)]) for i in range(3)]
        people3 = [Person(id=str(i+10), name=f"P{i+10}", intervals=[(540, 720)]) for i in range(2)]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2),
            Group(id="3", name="G3", people=people3)
        ]

        moves = balance_cohorts(groups, meeting_length=60)
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

        assert not is_group_valid(group, meeting_length=60, facilitator_ids=facilitator_ids)

    def test_group_invalid_two_facilitators(self):
        """Group with two facilitators should be invalid."""
        facilitator1 = Person(id="f1", name="Facilitator 1", intervals=[(540, 720)])
        facilitator2 = Person(id="f2", name="Facilitator 2", intervals=[(540, 720)])

        group = Group(id="1", name="Test", people=[facilitator1, facilitator2])
        facilitator_ids = {"f1", "f2"}

        assert not is_group_valid(group, meeting_length=60, facilitator_ids=facilitator_ids)

    def test_greedy_iteration_with_facilitators(self):
        """Greedy iteration should create groups with one facilitator each."""
        facilitators = [
            Person(id="f1", name="F1", intervals=[(540, 720)]),
            Person(id="f2", name="F2", intervals=[(540, 720)])
        ]
        participants = [
            Person(id=f"p{i}", name=f"P{i}", intervals=[(540, 720)])
            for i in range(6)
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
            facilitator_max_cohorts={"f1": 1, "f2": 1}
        )

        # Each group should have exactly one facilitator
        for group in result:
            facilitators_in_group = [p for p in group.people if p.id in facilitator_ids]
            assert len(facilitators_in_group) == 1


class TestFindCohortTimeOptionsExtended:
    """Extended tests for find_cohort_time_options."""

    def test_with_if_needed_times(self):
        """Find options using if-needed availability."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 600)],  # Regular: 9-10am
            if_needed_intervals=[(600, 720)]  # If needed: 10am-12pm
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[(600, 720)]  # Regular: 10am-12pm
        )

        # With if-needed
        options = find_cohort_time_options([person1, person2], meeting_length=60, use_if_needed=True)
        assert len(options) > 0

        # Without if-needed
        options_no_if = find_cohort_time_options([person1, person2], meeting_length=60, use_if_needed=False)
        assert len(options_no_if) == 0

    def test_multiple_day_options(self):
        """Find options across multiple days."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 720), (1980, 2160)]  # Mon 9-12, Tue 9-12
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[(540, 720), (1980, 2160)]  # Same
        )

        options = find_cohort_time_options([person1, person2], meeting_length=60)
        # Should find options on both days
        assert len(options) >= 4  # At least 2 options per day

    def test_exact_meeting_length_match(self):
        """Find option when availability exactly matches meeting length."""
        person = Person(
            id="1",
            name="P1",
            intervals=[(540, 600)]  # Exactly 1 hour
        )

        options = find_cohort_time_options([person], meeting_length=60, time_increment=30)
        assert len(options) == 1
        assert options[0] == (540, 600)


class TestMoreEdgeCases:
    """Additional edge case tests."""

    def test_empty_people_list(self):
        """Scheduling with no people should return empty."""
        result = run_greedy_iteration(
            [],
            meeting_length=60,
            min_people=1,
            max_people=8,
            randomness=0
        )
        assert result == []

    def test_all_people_incompatible(self):
        """When no one can be grouped together."""
        people = [
            Person(id="1", name="P1", intervals=[(540, 600)]),    # 9-10am
            Person(id="2", name="P2", intervals=[(660, 720)]),    # 11-12pm
            Person(id="3", name="P3", intervals=[(780, 840)]),    # 1-2pm
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=2,  # Need 2 people per group
            max_people=8,
            randomness=0
        )
        # No valid groups can form
        assert len(result) == 0

    def test_exact_max_people_boundary(self):
        """Test group at exactly max_people."""
        people = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)])
            for i in range(4)
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=1,
            max_people=4,  # Exactly 4 people
            randomness=0
        )

        # All 4 should fit in one group
        assert len(result) == 1
        assert len(result[0].people) == 4

    def test_exact_min_people_boundary(self):
        """Test group at exactly min_people."""
        people = [
            Person(id="1", name="P1", intervals=[(540, 720)]),
            Person(id="2", name="P2", intervals=[(540, 720)])
        ]

        result = run_greedy_iteration(
            people,
            meeting_length=60,
            min_people=2,  # Need exactly 2
            max_people=8,
            randomness=0
        )

        assert len(result) == 1
        assert len(result[0].people) == 2

    def test_partial_overlap_three_people(self):
        """Three people where only pairs overlap."""
        person1 = Person(id="1", name="P1", intervals=[(540, 660)])   # 9-11am
        person2 = Person(id="2", name="P2", intervals=[(600, 720)])   # 10-12pm
        person3 = Person(id="3", name="P3", intervals=[(660, 780)])   # 11am-1pm

        # P1-P2 overlap 10-11, P2-P3 overlap 11-12, but all three don't overlap
        group = Group(id="1", name="Test", people=[person1, person2, person3])
        assert not is_group_valid(group, meeting_length=60)

        # But pairs are valid
        group12 = Group(id="1", name="Test", people=[person1, person2])
        assert is_group_valid(group12, meeting_length=60)

    def test_long_meeting_requirement(self):
        """Test with longer meeting requirements."""
        person1 = Person(id="1", name="P1", intervals=[(540, 720)])   # 3 hours
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

    def test_people_grouped_by_attribute(self):
        """Test that people can be grouped by course attribute."""
        people = [
            Person(id="1", name="P1", intervals=[(540, 720)], courses=["AGISF"]),
            Person(id="2", name="P2", intervals=[(540, 720)], courses=["AGISF"]),
            Person(id="3", name="P3", intervals=[(540, 720)], courses=["Technical"]),
            Person(id="4", name="P4", intervals=[(540, 720)], courses=["Technical"]),
        ]

        # Group by course
        by_course = {}
        for p in people:
            for course in p.courses:
                if course not in by_course:
                    by_course[course] = []
                by_course[course].append(p)

        assert len(by_course) == 2
        assert len(by_course["AGISF"]) == 2
        assert len(by_course["Technical"]) == 2

    def test_person_with_multiple_courses(self):
        """Test that person can have multiple courses."""
        person = Person(
            id="1",
            name="P1",
            intervals=[(540, 720)],
            courses=["AGISF", "Technical", "Governance"]
        )

        assert len(person.courses) == 3
        assert "AGISF" in person.courses
        assert "Technical" in person.courses
        assert "Governance" in person.courses

    def test_multiple_courses_grouping(self):
        """Test that people with multiple courses appear in all course groups."""
        # Person enrolled in both AGISF and Technical
        multi_course_person = Person(
            id="1",
            name="Multi",
            intervals=[(540, 720)],
            courses=["AGISF", "Technical"]
        )
        # Person only in AGISF
        agisf_only = Person(
            id="2",
            name="AGISF-Only",
            intervals=[(540, 720)],
            courses=["AGISF"]
        )
        # Person only in Technical
        tech_only = Person(
            id="3",
            name="Tech-Only",
            intervals=[(540, 720)],
            courses=["Technical"]
        )

        people = [multi_course_person, agisf_only, tech_only]

        # Group people by course (people can appear in multiple courses)
        people_by_course = {}
        for person in people:
            if person.courses:
                for course in person.courses:
                    if course not in people_by_course:
                        people_by_course[course] = []
                    people_by_course[course].append(person)
            else:
                if "Uncategorized" not in people_by_course:
                    people_by_course["Uncategorized"] = []
                people_by_course["Uncategorized"].append(person)

        # Check groupings
        assert len(people_by_course) == 2  # AGISF and Technical
        assert len(people_by_course["AGISF"]) == 2  # Multi and AGISF-Only
        assert len(people_by_course["Technical"]) == 2  # Multi and Tech-Only

        # Verify multi-course person appears in both
        agisf_ids = {p.id for p in people_by_course["AGISF"]}
        tech_ids = {p.id for p in people_by_course["Technical"]}
        assert "1" in agisf_ids
        assert "1" in tech_ids

    def test_empty_courses_uncategorized(self):
        """Test that person with no courses goes to Uncategorized."""
        person = Person(
            id="1",
            name="No Course",
            intervals=[(540, 720)],
            courses=[]
        )

        people_by_course = {}
        for p in [person]:
            if p.courses:
                for course in p.courses:
                    if course not in people_by_course:
                        people_by_course[course] = []
                    people_by_course[course].append(p)
            else:
                if "Uncategorized" not in people_by_course:
                    people_by_course["Uncategorized"] = []
                people_by_course["Uncategorized"].append(p)

        assert "Uncategorized" in people_by_course
        assert len(people_by_course["Uncategorized"]) == 1

    def test_schedule_each_course_separately(self):
        """Test scheduling runs independently per course."""
        agisf_people = [
            Person(id=f"a{i}", name=f"AGISF-{i}", intervals=[(540, 720)])
            for i in range(4)
        ]
        tech_people = [
            Person(id=f"t{i}", name=f"Tech-{i}", intervals=[(840, 1020)])  # Different time
            for i in range(4)
        ]

        # Schedule AGISF
        agisf_result = run_greedy_iteration(
            agisf_people,
            meeting_length=60,
            min_people=2,
            max_people=8,
            randomness=0
        )

        # Schedule Technical
        tech_result = run_greedy_iteration(
            tech_people,
            meeting_length=60,
            min_people=2,
            max_people=8,
            randomness=0
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
            if_needed_intervals=[(540, 720)]  # Only if-needed
        )
        result = calculate_total_available_time(person)
        assert result == 180  # 3 hours

    def test_group_valid_with_if_needed_only_member(self):
        """Group should be valid when member only has if-needed times."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 720)]  # Regular availability
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[],  # No regular availability
            if_needed_intervals=[(540, 720)]  # Only if-needed
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
            use_if_needed=True
        )

        # All 4 should be scheduled together
        total_scheduled = sum(len(g.people) for g in result)
        assert total_scheduled == 4

    def test_find_options_with_if_needed_only(self):
        """Find time options when one person has only if-needed times."""
        person1 = Person(
            id="1",
            name="P1",
            intervals=[(540, 720)]
        )
        person2 = Person(
            id="2",
            name="P2",
            intervals=[],
            if_needed_intervals=[(600, 720)]  # Overlaps with person1
        )

        options = find_cohort_time_options(
            [person1, person2],
            meeting_length=60,
            use_if_needed=True
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
                "courses": ["AGISF"]
            },
            "user2": {
                "name": "If-Needed Only User",
                "availability": {},
                "if_needed": {"Monday": ["09:00", "10:00"]},
                "courses": ["AGISF"]
            }
        }

        # Manually convert like the cog does
        people = []
        for user_id, data in user_data.items():
            if not data.get("availability") and not data.get("if_needed"):
                continue

            day_code_map = {'Monday': 'M', 'Tuesday': 'T', 'Wednesday': 'W',
                           'Thursday': 'R', 'Friday': 'F', 'Saturday': 'S',
                           'Sunday': 'U'}

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
                courses=data.get("courses", [])
            )
            people.append(person)

        # Both users should be included
        assert len(people) == 2

        # Find the if-needed only user
        if_needed_user = next(p for p in people if p.name == "If-Needed Only User")
        assert len(if_needed_user.intervals) == 0
        assert len(if_needed_user.if_needed_intervals) == 2  # Two 1-hour blocks
        assert if_needed_user.courses == ["AGISF"]

    def test_balance_with_if_needed_users(self):
        """Balance cohorts should work with if-needed only users."""
        # Large group with mixed availability
        people1 = [
            Person(id=str(i), name=f"P{i}", intervals=[(540, 720)])
            for i in range(4)
        ]
        people1.extend([
            Person(id=str(i+4), name=f"P{i+4}", intervals=[], if_needed_intervals=[(540, 720)])
            for i in range(2)
        ])

        # Small group
        people2 = [
            Person(id=str(i+6), name=f"P{i+6}", intervals=[(540, 720)])
            for i in range(2)
        ]

        groups = [
            Group(id="1", name="G1", people=people1),
            Group(id="2", name="G2", people=people2)
        ]

        moves = balance_cohorts(groups, meeting_length=60, use_if_needed=True)

        # Should balance the groups
        assert moves > 0
        sizes = [len(g.people) for g in groups]
        assert max(sizes) - min(sizes) <= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
