"use client";

export default function Privacy() {
  return (
    <div className="py-12 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Privacy Policy</h1>
      <p className="text-slate-500 mb-8">Last updated: January 2025</p>

      <div className="prose prose-slate max-w-none">
        <p className="text-lg text-slate-600 mb-8">
          Lens Academy ("we", "us", "our") is committed to protecting your
          privacy. This policy explains how we collect, use, and protect your
          personal data when you use our AI safety education platform.
        </p>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            1. Data Controller
          </h2>
          <p className="text-slate-600">
            Lens Academy operates as the data controller for personal data
            collected through this platform. All data is stored and processed
            within the European Union.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            2. Data We Collect
          </h2>

          <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">
            2.1 Account Information
          </h3>
          <p className="text-slate-600 mb-2">
            When you sign up via Discord, we receive:
          </p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1">
            <li>Discord user ID and username</li>
            <li>Discord avatar (if set)</li>
            <li>Email address (if you grant permission)</li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">
            2.2 Profile Information
          </h3>
          <p className="text-slate-600 mb-2">Information you provide:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1">
            <li>Display name/nickname</li>
            <li>Timezone</li>
            <li>Availability preferences for group scheduling</li>
            <li>Notification preferences</li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">
            2.3 Learning Progress
          </h3>
          <p className="text-slate-600 mb-2">
            To provide the educational service:
          </p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1">
            <li>Course enrollment and completion status</li>
            <li>Lesson progress (started, completed)</li>
            <li>Group meeting attendance</li>
            <li>Chat interactions within lessons</li>
          </ul>

          <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">
            2.4 Analytics Data (With Consent)
          </h3>
          <p className="text-slate-600 mb-2">
            If you consent to analytics cookies, we collect:
          </p>
          <ul className="list-disc pl-6 text-slate-600 space-y-1">
            <li>Page views and navigation patterns</li>
            <li>Feature usage statistics</li>
            <li>Session duration and engagement metrics</li>
          </ul>
          <p className="text-slate-600 mt-2">
            You can withdraw consent at any time via the "Cookie Settings" link
            in the footer.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">
            2.5 Error Tracking (With Consent)
          </h3>
          <p className="text-slate-600">
            If you consent, we collect error reports to improve the platform.
            This may include session replays when errors occur, with sensitive
            content masked.
          </p>

          <h3 className="text-lg font-medium text-slate-800 mt-4 mb-2">
            2.6 Geolocation
          </h3>
          <p className="text-slate-600">
            We use a third-party service to detect your country to determine if
            GDPR cookie consent is required. This country code is not stored in
            our database.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            3. How We Use Your Data
          </h2>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>
              <strong>Provide the service:</strong> Authenticate you, track
              course progress, schedule group sessions, send reminders
            </li>
            <li>
              <strong>Communication:</strong> Send course updates, meeting
              reminders, and important notifications via email or Discord DM
            </li>
            <li>
              <strong>Improve the platform:</strong> Analyze usage patterns
              (with consent) to improve the learning experience
            </li>
            <li>
              <strong>Technical operation:</strong> Debug issues, ensure
              security, prevent abuse
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            4. Legal Basis for Processing (GDPR)
          </h2>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>
              <strong>Contract:</strong> Processing account and learning data to
              provide the educational service you signed up for
            </li>
            <li>
              <strong>Consent:</strong> Analytics and error tracking cookies
              (you can withdraw anytime)
            </li>
            <li>
              <strong>Legitimate interests:</strong> Security, fraud prevention,
              service improvement
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            5. Third-Party Services
          </h2>
          <p className="text-slate-600 mb-4">
            We use the following third-party services:
          </p>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-slate-600">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 pr-4 font-medium text-slate-800">
                    Service
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-slate-800">
                    Purpose
                  </th>
                  <th className="text-left py-2 font-medium text-slate-800">
                    Data Location
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2 pr-4">Discord</td>
                  <td className="py-2 pr-4">Authentication, community</td>
                  <td className="py-2">
                    US (Discord's privacy policy applies)
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Supabase/PostgreSQL</td>
                  <td className="py-2 pr-4">Database hosting</td>
                  <td className="py-2">EU</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">PostHog</td>
                  <td className="py-2 pr-4">Analytics (with consent)</td>
                  <td className="py-2">EU</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Sentry</td>
                  <td className="py-2 pr-4">Error tracking (with consent)</td>
                  <td className="py-2">US</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">ipapi.co</td>
                  <td className="py-2 pr-4">Geolocation (GDPR detection)</td>
                  <td className="py-2">Not stored</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            6. Data Retention
          </h2>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>
              <strong>Account data:</strong> Retained while your account is
              active. Deleted upon account deletion request.
            </li>
            <li>
              <strong>Learning progress:</strong> Retained for course completion
              records. May be anonymized for research after account deletion.
            </li>
            <li>
              <strong>Analytics data:</strong> Retained for up to 2 years, then
              deleted or anonymized.
            </li>
            <li>
              <strong>Error logs:</strong> Retained for up to 90 days.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            7. Your Rights (GDPR)
          </h2>
          <p className="text-slate-600 mb-4">You have the right to:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>
              <strong>Access:</strong> Request a copy of your personal data
            </li>
            <li>
              <strong>Rectification:</strong> Correct inaccurate personal data
            </li>
            <li>
              <strong>Erasure:</strong> Request deletion of your personal data
            </li>
            <li>
              <strong>Portability:</strong> Receive your data in a
              machine-readable format
            </li>
            <li>
              <strong>Restriction:</strong> Limit how we process your data
            </li>
            <li>
              <strong>Objection:</strong> Object to processing based on
              legitimate interests
            </li>
            <li>
              <strong>Withdraw consent:</strong> Withdraw analytics/tracking
              consent at any time
            </li>
          </ul>
          <p className="text-slate-600 mt-4">
            To exercise these rights, contact us at the address below.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            8. Cookies
          </h2>
          <p className="text-slate-600 mb-4">We use the following cookies:</p>
          <ul className="list-disc pl-6 text-slate-600 space-y-2">
            <li>
              <strong>Essential:</strong> Authentication tokens, consent
              preferences (always active)
            </li>
            <li>
              <strong>Analytics:</strong> PostHog tracking (requires consent)
            </li>
            <li>
              <strong>Error tracking:</strong> Sentry session data (requires
              consent)
            </li>
          </ul>
          <p className="text-slate-600 mt-4">
            Manage your preferences via "Cookie Settings" in the footer.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            9. Data Security
          </h2>
          <p className="text-slate-600">
            We implement appropriate technical and organizational measures to
            protect your data, including encryption in transit (HTTPS), secure
            authentication via Discord OAuth, and access controls for our team.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            10. Children's Privacy
          </h2>
          <p className="text-slate-600">
            This platform is not intended for users under 18 years of age. We do
            not knowingly collect personal data from children.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            11. Changes to This Policy
          </h2>
          <p className="text-slate-600">
            We may update this policy periodically. Significant changes will be
            communicated via email or platform notification. The "Last updated"
            date at the top indicates when the policy was last revised.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            12. Contact
          </h2>
          <p className="text-slate-600">
            For privacy inquiries or to exercise your data rights, contact us
            at:
          </p>
          <p className="text-slate-600 mt-2 p-4 bg-slate-50 rounded-lg">
            <strong>Lens Academy</strong>
            <br />
            Email: [Contact email to be added]
            <br />
            You may also reach us via our Discord server.
          </p>
        </section>

        <section className="mb-8 p-4 bg-violet-50 rounded-lg">
          <h2 className="text-lg font-semibold text-violet-900 mb-2">
            Supervisory Authority
          </h2>
          <p className="text-violet-700 text-sm">
            If you are in the EU/EEA and believe we have not adequately
            addressed your data protection concerns, you have the right to lodge
            a complaint with your local data protection authority.
          </p>
        </section>
      </div>
    </div>
  );
}
