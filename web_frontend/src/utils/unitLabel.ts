import type { UnitInfo } from "@/types/course";

export function getUnitLabel(unit: UnitInfo, unitIndex: number): string {
  if (unit.meetingName) return `${unit.meetingNumber}. ${unit.meetingName}`;
  if (unit.meetingNumber !== null) return `Week ${unit.meetingNumber}`;
  return `Week ${unitIndex + 1}`;
}
