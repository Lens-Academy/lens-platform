export default function Home() {
  return (
    <div className="py-16 max-w-2xl mx-auto text-center">
      <h1 className="text-4xl font-bold text-red-600 mb-4">
        404 - Something Went Wrong
      </h1>
      <p className="text-xl text-gray-600 mb-8">
        You reached the React Home component instead of the static landing page.
      </p>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-left mb-8">
        <h2 className="font-bold text-yellow-800 mb-2">Diagnostic Info:</h2>
        <ul className="text-sm text-yellow-700 space-y-2">
          <li>
            <strong>Issue:</strong> Two different homepages exist
          </li>
          <li>
            <strong>Static landing:</strong> web_frontend/static/landing.html
            (served on hard refresh)
          </li>
          <li>
            <strong>React component:</strong> web_frontend/src/pages/Home.tsx
            (served on client-side navigation)
          </li>
          <li>
            <strong>How you got here:</strong> Likely clicked a React Router
            Link to "/" instead of hard navigating
          </li>
        </ul>
      </div>

      <a href="/" className="text-emerald-600 underline">
        Hard refresh to see the real landing page
      </a>
    </div>
  );
}
