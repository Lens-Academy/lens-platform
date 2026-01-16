import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="py-8 text-center">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">404</h1>
      <p className="text-gray-600 mb-6">Page not found</p>
      <Link
        to="/"
        className="text-emerald-600 hover:text-emerald-800 underline"
      >
        Go back home
      </Link>
    </div>
  );
}
