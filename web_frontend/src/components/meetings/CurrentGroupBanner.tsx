interface CurrentGroupBannerProps {
  groupName: string;
  meetingTime: string;
  cohortName?: string;
}

export default function CurrentGroupBanner({
  groupName,
  meetingTime,
  cohortName,
}: CurrentGroupBannerProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-6 bg-gray-50">
      <p className="text-sm text-gray-500">Your group</p>
      <p className="font-medium text-gray-900">{groupName}</p>
      <p className="text-sm text-gray-600">{meetingTime}</p>
      {cohortName && (
        <p className="text-sm text-gray-500 mt-1">{cohortName}</p>
      )}
    </div>
  );
}
