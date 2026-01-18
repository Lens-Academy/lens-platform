import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Popover } from "../Popover";

interface Props {
  onLoginClick: () => void;
}

export default function HeaderAuthStatus({ onLoginClick }: Props) {
  const {
    isAuthenticated,
    isLoading,
    discordUsername,
    discordAvatarUrl,
    logout,
  } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <button
        onClick={onLoginClick}
        className="text-indigo-600 hover:text-indigo-700 text-sm font-medium hover:underline"
      >
        Sign in
      </button>
    );
  }

  return (
    <Popover
      placement="bottom-end"
      content={(close) => (
        <div className="flex flex-col gap-2">
          <Link
            to="/availability"
            onClick={close}
            className="text-sm text-gray-700 hover:text-gray-900"
          >
            Edit Availability
          </Link>
          <button
            onClick={() => {
              logout();
              close();
            }}
            className="w-full text-left text-sm text-gray-700 hover:text-gray-900"
          >
            Sign out
          </button>
        </div>
      )}
    >
      <button className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900">
        {discordAvatarUrl ? (
          <img
            src={discordAvatarUrl}
            alt={`${discordUsername}'s avatar`}
            className="w-6 h-6 rounded-full"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-gray-300" />
        )}
        <span>{discordUsername}</span>
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
    </Popover>
  );
}
