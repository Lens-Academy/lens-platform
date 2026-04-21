import { useState, useEffect, useMemo } from "react";
import EnrollWizard from "../components/enroll/EnrollWizard";
import ProspectEmailForm from "../components/ProspectEmailForm";
import { SelectMenu } from "../components/SelectMenu";
import SemiDonutChart from "../components/SemiDonutChart";
import { API_URL } from "../config";

interface CohortOption {
  cohort_id: number;
  cohort_name: string;
  course_slug: string;
  course_name: string;
  cohort_start_date: string;
  duration_days: number;
  accepts_availability_signups: boolean;
  has_joinable_groups: boolean;
}

const ENROLL_STATE_KEY = "lens-enroll-state";

function saveEnrollState(cohortId: number, courseSlug: string) {
  sessionStorage.setItem(
    ENROLL_STATE_KEY,
    JSON.stringify({ cohortId, slug: courseSlug }),
  );
}

function loadAndClearEnrollState(): {
  cohortId?: number;
  slug?: string;
} | null {
  const raw = sessionStorage.getItem(ENROLL_STATE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(ENROLL_STATE_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatDateRange(cohort: CohortOption): string {
  const start = new Date(cohort.cohort_start_date + "T00:00:00");
  const end = new Date(start);
  end.setDate(end.getDate() + cohort.duration_days);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function Enroll() {
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState<number | null>(null);
  const [step, setStep] = useState<"select" | "enroll">("select");

  const selectedCohort = cohorts.find((c) => c.cohort_id === selectedCohortId);

  const selectOptions = useMemo(
    () =>
      cohorts.map((c) => {
        const d = new Date(c.cohort_start_date + "T00:00:00");
        const short = d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return {
          value: c.cohort_id,
          label: c.course_name,
          description: `Starts ${short}`,
        };
      }),
    [cohorts],
  );

  useEffect(() => {
    const saved = loadAndClearEnrollState();

    fetch(`${API_URL}/api/cohorts/available-list`)
      .then((res) => res.json())
      .then((data) => {
        const list = data.cohorts as CohortOption[];
        setCohorts(list);

        if (saved?.cohortId) {
          setSelectedCohortId(saved.cohortId);
          setStep("enroll");
        } else if (saved?.slug) {
          const match = list.find((c) => c.course_slug === saved.slug);
          if (match) {
            setSelectedCohortId(match.cohort_id);
            setStep("enroll");
          }
        } else if (list.length === 1) {
          setSelectedCohortId(list[0].cohort_id);
        }
      })
      .catch(() => {});
  }, []);

  const handleNext = () => {
    if (!selectedCohort) return;
    saveEnrollState(selectedCohort.cohort_id, selectedCohort.course_slug);
    setStep("enroll");
  };

  // Step 2: enrollment wizard
  if (step === "enroll" && selectedCohort) {
    return (
      <div className="py-8">
        <div className="max-w-md mx-auto mb-4">
          <button
            type="button"
            onClick={() => setStep("select")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            &larr; Back to course selection
          </button>
        </div>
        <EnrollWizard
          courseSlug={selectedCohort.course_slug}
          preselectedCohortId={selectedCohort.cohort_id}
        />
      </div>
    );
  }

  // Step 1: course/cohort selection
  const cohortSelector = (id: string) => (
    <div className="max-w-md mx-auto">
      {cohorts.length > 0 ? (
        <>
          <label
            htmlFor={id}
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Choose a course to enroll in
          </label>
          <SelectMenu
            id={id}
            value={selectedCohortId}
            onChange={(id) => setSelectedCohortId(id as number)}
            placeholder="Select a course..."
            options={selectOptions}
          />

          {selectedCohort && (
            <p className="text-sm text-gray-500 mt-2">
              {formatDateRange(selectedCohort)}
            </p>
          )}

          {selectedCohortId && (
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
      ) : (
        <p className="text-sm text-gray-600 text-center">
          No courses are currently open for enrollment.
        </p>
      )}

      <p className="text-xs text-gray-500 mt-4">
        If the course you want is not available, leave your email address.
      </p>
      <ProspectEmailForm variant="inline" className="mt-2" />
    </div>
  );

  return (
    <div className="py-8">
      {/* Header */}
      <div className="max-w-2xl mx-auto text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
          Enroll in a Course
        </h1>
        <p className="text-gray-600">
          Learn why superintelligent AI could be catastrophic for
          humanity&thinsp;&mdash;&thinsp;and what to do about it.
        </p>
      </div>

      {/* Top cohort selector */}
      {cohortSelector("cohort-select-top")}

      {/* Course cards */}
      <div className="max-w-2xl mx-auto my-10">
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
      <div className="max-w-2xl mx-auto mb-10">
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

      {/* Bottom cohort selector */}
      <div className="border-t border-gray-200 max-w-md mx-auto my-8" />
      {cohortSelector("cohort-select-bottom")}

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
