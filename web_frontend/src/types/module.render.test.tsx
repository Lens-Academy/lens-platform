// src/types/module.render.test.tsx
/**
 * Comprehensive rendering tests for Module types.
 *
 * These tests verify that all fixtures from content_processor can be rendered
 * by a React component without crashing. This ensures the frontend types
 * are compatible with what the TypeScript processor produces.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Module, ModuleSection, ModuleSegment } from "./module";

// Import all fixtures
import minimalModuleFixture from "../../../content_processor/fixtures/valid/minimal-module/expected.json";
import videoNoTimestampsFixture from "../../../content_processor/fixtures/valid/video-no-timestamps/expected.json";
import uncategorizedMultipleLensesFixture from "../../../content_processor/fixtures/valid/uncategorized-multiple-lenses/expected.json";

// Simple test component that exercises the Module types
function TestModuleRenderer({ module }: { module: Module }) {
  return (
    <div data-testid="module">
      <h1 data-testid="module-title">{module.title}</h1>
      <span data-testid="module-slug">{module.slug}</span>
      {module.sections.map((section, i) => (
        <TestSectionRenderer key={i} section={section} index={i} />
      ))}
    </div>
  );
}

function TestSectionRenderer({
  section,
  index,
}: {
  section: ModuleSection;
  index: number;
}) {
  return (
    <div data-testid={`section-${index}`} data-section-type={section.type}>
      <span data-testid={`section-${index}-type`}>{section.type}</span>
      {renderSectionMeta(section, index)}
      {renderSectionSegments(section, index)}
    </div>
  );
}

function renderSectionMeta(section: ModuleSection, index: number) {
  switch (section.type) {
    case "page":
      return (
        <div data-testid={`section-${index}-meta`}>
          <span data-testid={`section-${index}-title`}>
            {section.meta.title ?? "Untitled"}
          </span>
        </div>
      );
    case "lens-video":
      return (
        <div data-testid={`section-${index}-meta`}>
          <span data-testid={`section-${index}-title`}>
            {section.meta.title}
          </span>
          <span data-testid={`section-${index}-channel`}>
            {section.meta.channel ?? "Unknown"}
          </span>
          <span data-testid={`section-${index}-videoId`}>
            {section.videoId ?? "No video ID"}
          </span>
          <span data-testid={`section-${index}-optional`}>
            {section.optional ? "optional" : "required"}
          </span>
        </div>
      );
    case "lens-article":
      return (
        <div data-testid={`section-${index}-meta`}>
          <span data-testid={`section-${index}-title`}>
            {section.meta.title}
          </span>
          <span data-testid={`section-${index}-author`}>
            {section.meta.author ?? "Unknown"}
          </span>
          <span data-testid={`section-${index}-optional`}>
            {section.optional ? "optional" : "required"}
          </span>
        </div>
      );
    case "text":
      return (
        <div data-testid={`section-${index}-content`}>{section.content}</div>
      );
    case "article":
    case "video":
    case "chat":
      // Legacy section types - just render type info
      return <div data-testid={`section-${index}-legacy`}>Legacy section</div>;
    default:
      return null;
  }
}

function renderSectionSegments(section: ModuleSection, sectionIndex: number) {
  if (!("segments" in section)) return null;

  return (
    <div data-testid={`section-${sectionIndex}-segments`}>
      {section.segments.map((segment, segIndex) => (
        <TestSegmentRenderer
          key={segIndex}
          segment={segment}
          sectionIndex={sectionIndex}
          segmentIndex={segIndex}
        />
      ))}
    </div>
  );
}

function TestSegmentRenderer({
  segment,
  sectionIndex,
  segmentIndex,
}: {
  segment: ModuleSegment;
  sectionIndex: number;
  segmentIndex: number;
}) {
  const testId = `section-${sectionIndex}-segment-${segmentIndex}`;

  switch (segment.type) {
    case "text":
      return (
        <div data-testid={testId} data-segment-type="text">
          {segment.content}
        </div>
      );
    case "article-excerpt":
      return (
        <div data-testid={testId} data-segment-type="article-excerpt">
          <span>{segment.content}</span>
          {segment.collapsed_before && (
            <span data-testid={`${testId}-collapsed-before`}>
              {segment.collapsed_before}
            </span>
          )}
          {segment.collapsed_after && (
            <span data-testid={`${testId}-collapsed-after`}>
              {segment.collapsed_after}
            </span>
          )}
        </div>
      );
    case "video-excerpt":
      return (
        <div data-testid={testId} data-segment-type="video-excerpt">
          <span data-testid={`${testId}-from`}>{segment.from}</span>
          <span data-testid={`${testId}-to`}>{segment.to ?? "end"}</span>
          <span data-testid={`${testId}-transcript`}>{segment.transcript}</span>
        </div>
      );
    case "chat":
      return (
        <div data-testid={testId} data-segment-type="chat">
          <span>{segment.instructions}</span>
        </div>
      );
    default:
      return null;
  }
}

// Test fixtures
const fixtures: { name: string; modules: Module[] }[] = [
  { name: "minimal-module", modules: minimalModuleFixture.modules },
  {
    name: "video-no-timestamps",
    modules: videoNoTimestampsFixture.modules,
  },
  {
    name: "uncategorized-multiple-lenses",
    modules: uncategorizedMultipleLensesFixture.modules,
  },
];

describe("Module rendering tests for all fixtures", () => {
  fixtures.forEach(({ name, modules }) => {
    describe(`Fixture: ${name}`, () => {
      modules.forEach((module, _moduleIndex) => {
        describe(`Module: ${module.slug}`, () => {
          it("renders without throwing", () => {
            expect(() => {
              render(<TestModuleRenderer module={module} />);
            }).not.toThrow();
          });

          it("renders module title and slug", () => {
            render(<TestModuleRenderer module={module} />);
            expect(screen.getByTestId("module-title")).toHaveTextContent(
              module.title,
            );
            expect(screen.getByTestId("module-slug")).toHaveTextContent(
              module.slug,
            );
          });

          it(`renders all ${module.sections.length} sections`, () => {
            render(<TestModuleRenderer module={module} />);
            module.sections.forEach((_, sectionIndex) => {
              expect(
                screen.getByTestId(`section-${sectionIndex}`),
              ).toBeInTheDocument();
            });
          });

          module.sections.forEach((section, sectionIndex) => {
            it(`section ${sectionIndex} has correct type: ${section.type}`, () => {
              render(<TestModuleRenderer module={module} />);
              const sectionEl = screen.getByTestId(`section-${sectionIndex}`);
              expect(sectionEl).toHaveAttribute(
                "data-section-type",
                section.type,
              );
            });

            if ("segments" in section && section.segments.length > 0) {
              it(`section ${sectionIndex} renders ${section.segments.length} segments`, () => {
                render(<TestModuleRenderer module={module} />);
                section.segments.forEach((_, segIndex) => {
                  expect(
                    screen.getByTestId(
                      `section-${sectionIndex}-segment-${segIndex}`,
                    ),
                  ).toBeInTheDocument();
                });
              });

              section.segments.forEach((segment, segIndex) => {
                it(`section ${sectionIndex} segment ${segIndex} has type: ${segment.type}`, () => {
                  render(<TestModuleRenderer module={module} />);
                  const segmentEl = screen.getByTestId(
                    `section-${sectionIndex}-segment-${segIndex}`,
                  );
                  expect(segmentEl).toHaveAttribute(
                    "data-segment-type",
                    segment.type,
                  );
                });
              });
            }
          });
        });
      });
    });
  });
});

describe("Section type-specific rendering", () => {
  it("lens-video section renders videoId correctly (nullable)", () => {
    // video-no-timestamps fixture has lens-video without videoId
    const module = videoNoTimestampsFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    // The section should render even without videoId
    expect(screen.getByTestId("section-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-0-videoId")).toHaveTextContent(
      "No video ID",
    );
  });

  it("lens-video section renders videoId when present", () => {
    // uncategorized-multiple-lenses has lens-video with videoId
    const module = uncategorizedMultipleLensesFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    expect(screen.getByTestId("section-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-0-videoId")).toHaveTextContent(
      "dQw4w9WgXcQ",
    );
  });

  it("lens-article section renders author correctly", () => {
    const module = uncategorizedMultipleLensesFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    // Section 1 is lens-article
    expect(screen.getByTestId("section-1")).toBeInTheDocument();
    expect(screen.getByTestId("section-1-author")).toHaveTextContent(
      "Jane Doe",
    );
  });

  it("page section renders title correctly", () => {
    const module = minimalModuleFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    expect(screen.getByTestId("section-0")).toBeInTheDocument();
    expect(screen.getByTestId("section-0-title")).toHaveTextContent(
      "What is AI Safety?",
    );
  });
});

describe("Segment type-specific rendering", () => {
  it("text segment renders content", () => {
    const module = minimalModuleFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    const segment = screen.getByTestId("section-0-segment-0");
    expect(segment).toHaveAttribute("data-segment-type", "text");
    expect(segment).toHaveTextContent(
      "This is the core content about AI Safety.",
    );
  });

  it("video-excerpt segment renders from/to/transcript", () => {
    const module = uncategorizedMultipleLensesFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    // Section 0, segment 1 is video-excerpt
    const segment = screen.getByTestId("section-0-segment-1");
    expect(segment).toHaveAttribute("data-segment-type", "video-excerpt");
    expect(screen.getByTestId("section-0-segment-1-from")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("section-0-segment-1-to")).toHaveTextContent(
      "60",
    );
    expect(
      screen.getByTestId("section-0-segment-1-transcript"),
    ).toHaveTextContent("0:00 - Welcome to AI safety.");
  });

  it("article-excerpt segment renders content", () => {
    const module = uncategorizedMultipleLensesFixture.modules[0];
    render(<TestModuleRenderer module={module} />);

    // Section 1, segment 1 is article-excerpt
    const segment = screen.getByTestId("section-1-segment-1");
    expect(segment).toHaveAttribute("data-segment-type", "article-excerpt");
    expect(segment).toHaveTextContent("The key insight.");
  });
});
