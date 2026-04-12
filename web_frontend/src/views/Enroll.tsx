import { useState, useEffect } from "react";
import EnrollWizard from "../components/enroll/EnrollWizard";
import ProspectEmailForm from "../components/ProspectEmailForm";
import SemiDonutChart from "../components/SemiDonutChart";
import { API_URL } from "../config";

interface CourseAvailability {
  course_slug: string;
  course_name: string;
  available: boolean;
  start_date: string | null;
}

const ENROLL_STATE_KEY = "lens-enroll-state";

function saveEnrollState(slug: string) {
  sessionStorage.setItem(ENROLL_STATE_KEY, JSON.stringify({ slug }));
}

function loadAndClearEnrollState(): { slug: string } | null {
  const raw = sessionStorage.getItem(ENROLL_STATE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(ENROLL_STATE_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatStartDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function Enroll() {
  const [courses, setCourses] = useState<CourseAvailability[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [step, setStep] = useState<"select" | "enroll">("select");

  useEffect(() => {
    // Restore state after OAuth redirect
    const saved = loadAndClearEnrollState();

    fetch(`${API_URL}/api/cohorts/course-availability`)
      .then((res) => res.json())
      .then((data) => {
        setCourses(data.courses);

        if (saved?.slug) {
          // Returning from OAuth — restore selection and go to enroll
          setSelectedSlug(saved.slug);
          setStep("enroll");
        } else {
          // Fresh visit — auto-select if only one available
          const available = (data.courses as CourseAvailability[]).filter(
            (c) => c.available,
          );
          if (available.length === 1) {
            setSelectedSlug(available[0].course_slug);
          }
        }
      })
      .catch(() => {});
  }, []);

  const availableCourses = courses.filter((c) => c.available);
  const selectedCourse = courses.find((c) => c.course_slug === selectedSlug);

  const handleNext = () => {
    // Save state before potential OAuth redirect
    saveEnrollState(selectedSlug);
    setStep("enroll");
  };

  // Step 2: enrollment wizard
  if (step === "enroll" && selectedSlug) {
    return (
      <div className="py-8">
        <div className="max-w-md mx-auto px-4 mb-4">
          <button
            type="button"
            onClick={() => setStep("select")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; Back to course selection
          </button>
        </div>
        <EnrollWizard courseSlug={selectedSlug} />
      </div>
    );
  }

  // Step 1: course selection
  const courseSelector = (id: string) => (
    <div className="max-w-md mx-auto px-4">
      {availableCourses.length > 0 ? (
        <>
          <label
            htmlFor={id}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Choose a course to enroll in
          </label>
          <select
            id={id}
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[var(--brand-accent)] focus:border-[var(--brand-accent)] outline-none"
          >
            <option value="">Select a course...</option>
            {availableCourses.map((c) => (
              <option key={c.course_slug} value={c.course_slug}>
                {c.course_name}
              </option>
            ))}
          </select>

          {/* Start date for selected course */}
          {selectedCourse?.start_date && (
            <p className="text-sm text-gray-500 mt-2">
              Starts {formatStartDate(selectedCourse.start_date)}
            </p>
          )}

          {/* Next button */}
          {selectedSlug && (
            <button
              type="button"
              onClick={handleNext}
              className="w-full mt-4 px-4 py-3 font-medium rounded-lg text-white transition-colors"
              style={{ backgroundColor: "var(--brand-accent)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--brand-accent-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--brand-accent)")
              }
            >
              Next
            </button>
          )}
        </>
      ) : courses.length > 0 ? (
        <p className="text-sm text-gray-600 text-center">
          No courses are currently open for enrollment.
        </p>
      ) : null}

      {/* Notify me — compact */}
      <p className="text-xs text-gray-500 mt-4">
        If the course you want is not available, leave your email address.
      </p>
      <ProspectEmailForm variant="inline" className="mt-2" />
    </div>
  );

  return (
    <div className="py-8">
      {/* Header */}
      <div className="max-w-2xl mx-auto px-4 text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
          Enroll in a Course
        </h1>
        <p className="text-gray-600">
          Learn why superintelligent AI could be catastrophic for
          humanity&thinsp;&mdash;&thinsp;and what to do about it.
        </p>
      </div>

      {/* Top course selector */}
      {courseSelector("course-select-top")}

      {/* Course cards */}
      <div className="max-w-2xl mx-auto px-4 my-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Course 1: Superintelligence 101 */}
          <div className="p-5 rounded-lg border border-gray-200 bg-gray-50 flex flex-col">
            <span
              className="inline-block self-start text-xs font-semibold tracking-wide uppercase px-2.5 py-0.5 rounded-full mb-3 text-white"
              style={{ backgroundColor: "var(--brand-accent)" }}
            >
              Starting 20 April 2026
            </span>
            <h3 className="text-base font-bold text-gray-900 mb-1">
              Superintelligence 101
            </h3>
            <p className="text-xs text-gray-500 mb-1">
              If Anyone Builds It, Everyone Dies
            </p>
            <p className="text-sm text-gray-600 leading-relaxed mb-4 flex-1">
              Read and discuss the book together with a group. Weekly sessions
              exploring the arguments, evidence, and implications with fellow
              students and an AI tutor.
            </p>
            <a
              href="/course/superintelligence-101"
              className="text-sm font-medium hover:underline"
              style={{ color: "var(--brand-accent)" }}
            >
              Browse Curriculum &rarr;
            </a>
          </div>

          {/* Course 2: Navigating Superintelligence */}
          <div className="p-5 rounded-lg border border-gray-200 bg-gray-50 flex flex-col">
            <span className="inline-block self-start text-xs font-semibold tracking-wide uppercase px-2.5 py-0.5 rounded-full mb-3 border border-gray-300 text-gray-500">
              Starting May 2026
            </span>
            <h3 className="text-base font-bold text-gray-900 mb-1">
              Navigating Superintelligence
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-4 flex-1">
              The core arguments for why superintelligence poses an existential
              risk, what makes alignment genuinely hard, and how to think about
              what to do about it.
            </p>
            <a
              href="/course/default"
              className="text-sm font-medium hover:underline"
              style={{ color: "var(--brand-accent)" }}
            >
              Browse Curriculum &rarr;
            </a>
          </div>
        </div>
      </div>

      {/* How Our Courses Work */}
      <div className="max-w-2xl mx-auto px-4 mb-10">
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] gap-6 items-center">
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-3">
              How Our Courses Work
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              We&rsquo;ll set you up with a group based on your availability.
              Each week you&rsquo;ll study the material with help from our AI
              Tutor. Then, you&rsquo;ll meet online with your group for a
              discussion guided by one of our
              navigators&thinsp;&mdash;&thinsp;experienced volunteers who help
              you get the most out of the material.
            </p>
          </div>
          <SemiDonutChart />
        </div>
      </div>

      {/* Bottom course selector */}
      <div className="border-t border-gray-200 max-w-md mx-auto my-8" />
      {courseSelector("course-select-bottom")}

      {/* Link to homepage */}
      <p className="text-sm text-gray-500 text-center mt-6">
        Want more context first?{" "}
        <a
          href="/"
          className="hover:underline"
          style={{ color: "var(--brand-accent)" }}
        >
          Visit our homepage.
        </a>
      </p>
    </div>
  );
}
