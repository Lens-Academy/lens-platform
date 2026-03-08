import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
// d3-force-3d is a transitive dep of force-graph (the only d3-force available)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — no type declarations for d3-force-3d
import { forceCollide } from "d3-force-3d";
import { API_URL } from "@/config";

// --- Types ---

interface GraphNode {
  id: string;
  type: "course" | "parent-module" | "module" | "lens" | "root";
  title: string;
  slug: string;
  orphan?: boolean;
  wip?: boolean;
  sectionType?: string;
  file?: string | null;
  band: number;
  // force-graph adds these at runtime
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// --- Constants ---

const COLORS = {
  course: "#f59e0b",
  parentModule: "#60a5fa",
  module: "#3b82f6",
  orphan: "#6b7280",
  lensArticle: "#10b981",
  lensVideo: "#8b5cf6",
} as const;

function getNodeColor(node: GraphNode): string {
  if (node.type === "root") return "transparent";
  if (node.type === "course") return COLORS.course;
  if (node.type === "parent-module")
    return node.orphan ? COLORS.orphan : COLORS.parentModule;
  if (node.type === "module") return node.orphan ? COLORS.orphan : COLORS.module;
  if (node.type === "lens") {
    if (node.sectionType === "video" || node.sectionType === "lens-video")
      return COLORS.lensVideo;
    return COLORS.lensArticle;
  }
  return COLORS.lensArticle;
}

function getNodeRadius(node: GraphNode, focused: boolean): number {
  if (node.type === "root") return 0;
  if (node.type === "course") return focused ? 12 : 8;
  if (node.type === "parent-module") return focused ? 10 : 7;
  if (node.type === "module") return focused ? 8 : 5;
  return focused ? 5 : 3;
}

// --- NodeDetail ---

function NodeDetail({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  const color = getNodeColor(node);

  let platformLink: string | null = null;
  if (node.type === "course") platformLink = `/course/${node.slug}`;
  else if (node.type === "module" || node.type === "parent-module")
    platformLink = `/module/${node.slug}`;

  const githubLink =
    node.file
      ? `https://github.com/Lens-Academy/lens-edu-relay/blob/staging/${node.file}`
      : null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-700/50 p-4 min-w-72 max-w-md">
      <button
        onClick={onClose}
        className="absolute top-2 right-3 text-gray-400 hover:text-white text-lg"
      >
        &times;
      </button>
      <h3 className="text-white text-lg font-semibold pr-6">{node.title}</h3>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: color }}
        >
          {node.type}
          {node.type === "lens" && node.sectionType
            ? ` (${node.sectionType})`
            : ""}
        </span>
        {node.orphan && (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-600 text-white">
            orphan
          </span>
        )}
        {node.wip && (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-700 text-white">
            WIP
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-3 text-sm">
        {platformLink && (
          <a
            href={platformLink}
            className="text-blue-400 hover:text-blue-300 underline"
          >
            View on platform
          </a>
        )}
        {githubLink && (
          <a
            href={githubLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            Edit on GitHub
          </a>
        )}
      </div>
    </div>
  );
}

// --- OverviewToolbar ---

interface ForceSettings {
  chargeStrength: number;
  bandWidth: number;
}

const DEFAULT_FORCES: ForceSettings = {
  chargeStrength: -250,
  bandWidth: 120,
};

// Band boundaries with gaps between them.
// band 0 = root (pinned to origin)
// band 1 = [0, bw]
// band 2 = [bw + gap, 2*bw + gap]
// band 3 = [2*bw + 2*gap, 3*bw + 2*gap]
const BAND_GAP = 30;

function getBandRange(band: number, bw: number): [number, number] {
  if (band <= 0) return [0, 0];
  const start = (band - 1) * bw + (band - 1) * BAND_GAP;
  return [start, start + bw];
}

function ForceSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-gray-400">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500"
      />
    </div>
  );
}

function OverviewToolbar({
  showOrphans,
  setShowOrphans,
  showWip,
  setShowWip,
  forces,
  setForces,
}: {
  showOrphans: boolean;
  setShowOrphans: (v: boolean) => void;
  showWip: boolean;
  setShowWip: (v: boolean) => void;
  forces: ForceSettings;
  setForces: (v: ForceSettings) => void;
}) {
  const legendItems = [
    { color: COLORS.course, label: "Course" },
    { color: COLORS.parentModule, label: "Parent module" },
    { color: COLORS.module, label: "Module" },
    { color: COLORS.lensArticle, label: "Lens (article)" },
    { color: COLORS.lensVideo, label: "Lens (video)" },
    { color: COLORS.orphan, label: "Orphan" },
  ];

  return (
    <div className="fixed top-4 left-4 z-50 bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-700/50 p-3 text-sm w-56" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex flex-col gap-1.5 mb-3">
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-gray-300">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-700/50 pt-2 flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
            className="accent-blue-500"
          />
          Show orphans
        </label>
        <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showWip}
            onChange={(e) => setShowWip(e.target.checked)}
            className="accent-blue-500"
          />
          Show WIP
        </label>
      </div>
      <div className="border-t border-gray-700/50 pt-2 mt-2 flex flex-col gap-2">
        <ForceSlider
          label="Repulsion"
          value={forces.chargeStrength}
          min={-300}
          max={0}
          step={10}
          onChange={(v) => setForces({ ...forces, chargeStrength: v })}
        />
        <ForceSlider
          label="Band width"
          value={forces.bandWidth}
          min={50}
          max={400}
          step={10}
          onChange={(v) => setForces({ ...forces, bandWidth: v })}
        />
      </div>
    </div>
  );
}

// --- OverviewPage ---

export default function Page() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<ForceGraphMethods<any, any>>(undefined);
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [showOrphans, setShowOrphans] = useState(true);
  const [showWip, setShowWip] = useState(true);
  const [forces, setForces] = useState<ForceSettings>(DEFAULT_FORCES);

  // Store bandWidth in a ref so the tick callback always reads the latest value
  const bandWidthRef = useRef(forces.bandWidth);
  bandWidthRef.current = forces.bandWidth;

  // Track zoom level for label visibility
  const zoomRef = useRef(1);

  // Apply d3 force settings when sliders change
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge") as unknown as
      | { strength: (v: number) => void }
      | undefined;
    charge?.strength(forces.chargeStrength);
    // Collision force prevents nodes from overlapping
    fg.d3Force(
      "collision",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      forceCollide((node: any) => {
        if (node.type === "course") return 20;
        if (node.type === "parent-module") return 16;
        if (node.type === "module") return 12;
        return 6;
      }),
    );
    // Link attraction — pull connected nodes closer within their bands
    fg.d3Force("link")?.distance(10)?.strength(0.8);
    fg.d3ReheatSimulation();
  }, [forces.chargeStrength, forces.bandWidth]);

  // Clamp nodes to bands after each simulation tick
  const clampBands = useCallback(() => {
    const bw = bandWidthRef.current;
    for (const node of graphData.nodes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n = node as any;
      if (n.band === 0) {
        n.x = 0;
        n.y = 0;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      const [minR, maxR] = getBandRange(n.band, bw);
      const dist = Math.sqrt(n.x * n.x + n.y * n.y) || 0.01;
      if (dist < minR || dist > maxR) {
        const targetR = dist < minR ? minR : maxR;
        const scale = targetR / dist;
        n.x *= scale;
        n.y *= scale;
        // Kill radial velocity so node doesn't keep pushing out
        const ux = n.x / targetR;
        const uy = n.y / targetR;
        const radialV = (n.vx || 0) * ux + (n.vy || 0) * uy;
        n.vx = (n.vx || 0) - radialV * ux;
        n.vy = (n.vy || 0) - radialV * uy;
      }
    }
  }, [graphData.nodes]);

  // Fetch graph data
  useEffect(() => {
    fetch(`${API_URL}/api/content/graph`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: GraphData) => {
        setGraphData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Reduce scroll zoom sensitivity
  useEffect(() => {
    const el = document.querySelector("canvas");
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const reduced = new WheelEvent("wheel", {
        deltaY: e.deltaY * 0.4,
        deltaX: e.deltaX * 0.4,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        ctrlKey: false, // strip ctrl so d3-zoom treats it as normal scroll zoom
        bubbles: true,
        cancelable: true,
      });
      // Temporarily remove listener to avoid recursion
      el.removeEventListener("wheel", handler);
      el.dispatchEvent(reduced);
      el.addEventListener("wheel", handler, { passive: false });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [graphData]);

  // Escape key to clear focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedNodeId(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Compute connected node IDs
  const connectedNodeIds = useMemo(() => {
    if (!focusedNodeId) return null;
    const ids = new Set<string>();
    ids.add(focusedNodeId);
    for (const link of graphData.links) {
      const sourceId =
        typeof link.source === "object" ? link.source.id : link.source;
      const targetId =
        typeof link.target === "object" ? link.target.id : link.target;
      if (sourceId === focusedNodeId) ids.add(targetId);
      if (targetId === focusedNodeId) ids.add(sourceId);
    }
    return ids;
  }, [focusedNodeId, graphData.links]);

  const focusedNode = useMemo(() => {
    if (!focusedNodeId) return null;
    return graphData.nodes.find((n) => n.id === focusedNodeId) ?? null;
  }, [focusedNodeId, graphData.nodes]);

  const handleFocus = useCallback((node: GraphNode) => {
    if (node.type === "root") return;
    setFocusedNodeId(node.id);
  }, []);

  const clearFocus = useCallback(() => {
    setFocusedNodeId(null);
  }, []);

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D) => {
      if (node.type === "root") return; // invisible anchor
      const color = getNodeColor(node);
      const isFocused = focusedNodeId === node.id;
      const isNeighbor = connectedNodeIds?.has(node.id) ?? false;
      const isDimmed = focusedNodeId !== null && !isNeighbor;
      const radius = getNodeRadius(node, isFocused);
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      ctx.save();

      if (isDimmed) {
        ctx.globalAlpha = 0.2;
      }

      // Glow for focused node
      if (isFocused) {
        ctx.beginPath();
        ctx.arc(x, y, radius * 2, 0, 2 * Math.PI);
        ctx.fillStyle = color + "40";
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Zoom-based label visibility:
      // courses: always, parent-modules/modules: zoom >= 2, lenses: zoom >= 4
      const zoom = zoomRef.current;
      const showLabel =
        isFocused ||
        node.type === "course" ||
        node.type === "parent-module" ||
        node.type === "module" ||
        (node.type === "lens" && zoom > 1.5);

      if (showLabel) {
        ctx.font = `${isFocused ? 4 : 3}px Sans-Serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isDimmed ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.9)";
        ctx.fillText(node.title, x, y + radius + 2);
      }

      ctx.restore();
    },
    [focusedNodeId, connectedNodeIds],
  );

  // Draw filled concentric bands behind the graph
  const paintBands = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const bw = forces.bandWidth;
      const halfGap = BAND_GAP / 2;

      const BAND_FILLS = [
        "", // band 0 (root, not drawn)
        "rgba(245, 158, 11, 0.06)", // courses — warm amber
        "rgba(59, 130, 246, 0.06)", // modules — blue
        "rgba(16, 185, 129, 0.06)", // lenses — green
      ];

      ctx.save();

      // Fill each band as an annulus, extending halfway into the gap on each side
      for (let band = 1; band <= 3; band++) {
        const [inner, outer] = getBandRange(band, bw);
        const visInner = Math.max(0, inner - halfGap);
        const visOuter = outer + halfGap;

        ctx.beginPath();
        ctx.arc(0, 0, visOuter, 0, 2 * Math.PI);
        ctx.arc(0, 0, visInner, 0, 2 * Math.PI, true);
        ctx.fillStyle = BAND_FILLS[band];
        ctx.fill();
      }

      // Divider lines at the midpoint between adjacent bands
      for (let band = 1; band < 3; band++) {
        const [, outer] = getBandRange(band, bw);
        const midpoint = outer + halfGap;
        ctx.beginPath();
        ctx.arc(0, 0, midpoint, 0, 2 * Math.PI);
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.restore();
    },
    [forces.bandWidth],
  );

  const paintArea = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      const radius = getNodeRadius(node, focusedNodeId === node.id);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [focusedNodeId],
  );

  const nodeVisibility = useCallback(
    (node: GraphNode) => {
      if (!showOrphans && node.orphan) return false;
      if (!showWip && node.wip) return false;
      return true;
    },
    [showOrphans, showWip],
  );

  const linkVisibility = useCallback(
    (link: GraphLink) => {
      const s = typeof link.source === "object" ? (link.source as GraphNode) : null;
      const t = typeof link.target === "object" ? (link.target as GraphNode) : null;
      // Hide root→course links (virtual root is invisible)
      if (s?.type === "root" || t?.type === "root") return false;
      if (s && !showOrphans && s.orphan) return false;
      if (t && !showOrphans && t.orphan) return false;
      if (s && !showWip && s.wip) return false;
      if (t && !showWip && t.wip) return false;
      return true;
    },
    [showOrphans, showWip],
  );

  const linkColor = useCallback(
    (link: GraphLink) => {
      if (!focusedNodeId) return "rgba(255,255,255,0.15)";
      const sourceId =
        typeof link.source === "object" ? link.source.id : link.source;
      const targetId =
        typeof link.target === "object" ? link.target.id : link.target;
      const isConnected =
        sourceId === focusedNodeId || targetId === focusedNodeId;
      return isConnected
        ? "rgba(255,255,255,0.4)"
        : "rgba(255,255,255,0.03)";
    },
    [focusedNodeId],
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center w-screen h-screen"
        style={{ backgroundColor: "#1a1a2e" }}
      >
        <p className="text-gray-400 text-lg">Loading graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex items-center justify-center w-screen h-screen"
        style={{ backgroundColor: "#1a1a2e" }}
      >
        <p className="text-red-400 text-lg">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden" style={{ backgroundColor: "#1a1a2e" }}>
      <OverviewToolbar
        showOrphans={showOrphans}
        setShowOrphans={setShowOrphans}
        showWip={showWip}
        setShowWip={setShowWip}
        forces={forces}
        setForces={setForces}
      />

      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        onRenderFramePre={paintBands}
        onEngineTick={clampBands}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={paintArea}
        onNodeClick={handleFocus}
        onBackgroundClick={clearFocus}
        nodeLabel={(node: GraphNode) => node.type === "root" ? "" : node.title}
        linkColor={linkColor}
        linkWidth={1}
        backgroundColor="#1a1a2e"
        cooldownTicks={100}
        onZoom={({ k }) => { zoomRef.current = k; }}
        onEngineStop={() => fgRef.current?.zoomToFit(400)}
        nodeVisibility={nodeVisibility}
        linkVisibility={linkVisibility}
      />

      {focusedNode && (
        <NodeDetail node={focusedNode} onClose={clearFocus} />
      )}
    </div>
  );
}
