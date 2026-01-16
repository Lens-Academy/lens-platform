export type DayName =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type TimeSlot = string; // "09:00", "14:00", etc.

export type AvailabilityData = Record<DayName, TimeSlot[]>;

export interface Cohort {
  cohort_id: number;
  cohort_name: string;
  cohort_start_date: string;
  course_name: string;
  duration_days: number;
  role?: string;
}

export interface SignupFormData {
  displayName: string;
  email: string;
  discordConnected: boolean;
  discordUsername?: string;
  termsAccepted: boolean;
  availability: AvailabilityData;
  timezone: string;
  selectedCohortId: number | null;
  selectedRole: string | null;
}

export const DAY_NAMES: DayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const EMPTY_AVAILABILITY: AvailabilityData = {
  Monday: [],
  Tuesday: [],
  Wednesday: [],
  Thursday: [],
  Friday: [],
  Saturday: [],
  Sunday: [],
};

export function formatTimeSlot(slot: number): TimeSlot {
  const startHour = Math.floor(slot);
  const startMin = slot % 1 >= 0.5 ? "30" : "00";
  const endSlot = slot + 0.5;
  const endHour = Math.floor(endSlot);
  const endMin = endSlot % 1 >= 0.5 ? "30" : "00";
  const start = `${startHour.toString().padStart(2, "0")}:${startMin}`;
  const end = `${endHour.toString().padStart(2, "0")}:${endMin}`;
  return `${start}-${end}`;
}

export function parseTimeSlot(slot: TimeSlot): number {
  // Parse "HH:MM-HH:MM" back to slot number (uses start time)
  const start = slot.split("-")[0];
  const [hour, min] = start.split(":").map(Number);
  return hour + (min >= 30 ? 0.5 : 0);
}

export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function getTimezoneOffset(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  });
  const parts = formatter.formatToParts(now);
  const offsetPart = parts.find((p) => p.type === "timeZoneName");
  return offsetPart?.value ?? "";
}

export function formatTimezoneDisplay(timezone: string): string {
  const offset = getTimezoneOffset(timezone);
  const name = timezone.replace(/_/g, " ");
  return `${name} (${offset})`;
}

export const COMMON_TIMEZONES = [
  "Pacific/Honolulu", // GMT-10
  "America/Anchorage", // GMT-9
  "America/Los_Angeles", // GMT-8
  "America/Denver", // GMT-7
  "America/Chicago", // GMT-6
  "America/New_York", // GMT-5
  "America/Halifax", // GMT-4
  "America/Sao_Paulo", // GMT-3
  "Atlantic/South_Georgia", // GMT-2
  "Atlantic/Azores", // GMT-1
  "Europe/London", // GMT+0
  "Europe/Paris", // GMT+1
  "Europe/Athens", // GMT+2
  "Europe/Moscow", // GMT+3
  "Asia/Dubai", // GMT+4
  "Asia/Karachi", // GMT+5
  "Asia/Kolkata", // GMT+5:30
  "Asia/Dhaka", // GMT+6
  "Asia/Bangkok", // GMT+7
  "Asia/Singapore", // GMT+8
  "Asia/Tokyo", // GMT+9
  "Australia/Brisbane", // GMT+10
  "Australia/Sydney", // GMT+11
  "Pacific/Fiji", // GMT+12
  "Pacific/Auckland", // GMT+13
] as const;
