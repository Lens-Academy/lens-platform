import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../hooks/useAuth";
import Layout from "@/components/Layout";
import {
  getMyLinks,
  createLink,
  updateLink,
  deleteLink,
  type ReferralLink,
} from "../../api/referrals";
import {
  Copy,
  Check,
  Plus,
  Link as LinkIcon,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const BASE_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : "https://lensacademy.ai";

function linkUrl(slug: string) {
  return `${BASE_URL}/ref/${slug}`;
}

const SHARE_MESSAGE = (url: string) =>
  `I've been taking this AI Safety course and thought you'd enjoy it too: ${url}`;

/* ── Tiny copy button (icon-only, for inline use) ── */
function CopyIcon({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-[var(--brand-bg-muted,#f3f4f6)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
      title="Copy link"
    >
      {copied ? (
        <Check className="w-4 h-4 text-green-600" />
      ) : (
        <Copy className="w-4 h-4" />
      )}
    </button>
  );
}

/* ── Prominent copy button ── */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
        bg-[var(--brand-accent)] text-[var(--brand-accent-text,white)]
        hover:opacity-90 transition-opacity"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          {label || "Copy Link"}
        </>
      )}
    </button>
  );
}

/* ── Link card (used for each referral link) ── */
function LinkCard({
  link,
  onUpdateSlug,
  onDelete,
}: {
  link: ReferralLink;
  onUpdateSlug: (linkId: number, slug: string) => Promise<void>;
  onDelete?: (linkId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugValue, setSlugValue] = useState(link.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = linkUrl(link.slug);
  const hasActivity =
    link.clicks > 0 ||
    link.signups > 0 ||
    link.enrolled > 0 ||
    link.completed > 0;

  const handleSaveSlug = async () => {
    if (!slugValue.trim() || slugValue === link.slug) {
      setEditingSlug(false);
      setSlugValue(link.slug);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdateSlug(link.link_id, slugValue.trim());
      setEditingSlug(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--brand-border)] bg-[var(--brand-bg)]">
      {/* Main row: link URL + copy + stats summary */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-[var(--brand-text-muted)]">
              {link.is_default ? "Your link" : link.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <code className="text-sm break-all">{url}</code>
            <CopyIcon text={url} />
          </div>
        </div>

        {/* Stats summary */}
        <div className="hidden sm:flex items-center gap-4 text-sm text-[var(--brand-text-muted)] tabular-nums">
          <span title="Clicks">{link.clicks} clicks</span>
          <span title="Signups">{link.signups} signups</span>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 rounded hover:bg-[var(--brand-bg-muted,#f3f4f6)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
          title={expanded ? "Collapse" : "Details"}
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--brand-border)] pt-3 space-y-4">
          {/* Full funnel stats */}
          <div className="grid grid-cols-4 gap-3 text-center">
            {[
              { label: "Clicks", value: link.clicks },
              { label: "Signups", value: link.signups },
              { label: "Enrolled", value: link.enrolled },
              { label: "Completed", value: link.completed },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-xl font-semibold tabular-nums">
                  {stat.value}
                </div>
                <div className="text-xs text-[var(--brand-text-muted)]">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Slug editing */}
          <div className="flex flex-wrap items-center gap-2">
            {editingSlug ? (
              <>
                <span className="text-sm text-[var(--brand-text-muted)]">
                  Slug:
                </span>
                <input
                  type="text"
                  value={slugValue}
                  onChange={(e) => setSlugValue(e.target.value)}
                  className="text-sm px-2 py-1 border border-[var(--brand-border)] rounded bg-[var(--brand-bg)] text-[var(--brand-text)] w-40"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveSlug();
                    if (e.key === "Escape") {
                      setEditingSlug(false);
                      setSlugValue(link.slug);
                    }
                  }}
                  disabled={saving}
                />
                <button
                  onClick={handleSaveSlug}
                  disabled={saving}
                  className="px-2 py-1 text-xs font-medium rounded bg-[var(--brand-accent)] text-[var(--brand-accent-text,white)] hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingSlug(false);
                    setSlugValue(link.slug);
                    setError(null);
                  }}
                  className="px-2 py-1 text-xs font-medium rounded border border-[var(--brand-border)] text-[var(--brand-text-muted)]"
                >
                  Cancel
                </button>
                {error && <span className="text-xs text-red-500">{error}</span>}
              </>
            ) : (
              <button
                onClick={() => setEditingSlug(true)}
                className="text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
              >
                Change slug ({link.slug})
              </button>
            )}
          </div>

          {/* Delete */}
          {onDelete && (
            <button
              onClick={() => onDelete(link.link_id)}
              className="text-xs text-[var(--brand-text-muted)] hover:text-red-600 transition-colors"
            >
              Delete this link
            </button>
          )}

          {!hasActivity && (
            <p className="text-xs text-[var(--brand-text-muted)] italic">
              No activity yet. Share the link to start tracking referrals.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Create campaign link form ── */
function CreateLinkForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createLink(name.trim(), slug.trim() || undefined);
      setName("");
      setSlug("");
      setExpanded(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create link");
    } finally {
      setCreating(false);
    }
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium
          border border-dashed border-[var(--brand-border)] text-[var(--brand-text-muted)]
          hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] transition-colors"
      >
        <Plus className="w-4 h-4" />
        New campaign link
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 p-4 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-bg-muted,#f9fafb)]"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--brand-text-muted)]">
          Name *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Twitter Bio"
          className="px-3 py-1.5 text-sm border border-[var(--brand-border)] rounded bg-[var(--brand-bg)] text-[var(--brand-text)]"
          required
          autoFocus
          disabled={creating}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--brand-text-muted)]">
          Custom slug (optional)
        </label>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="auto-generated"
          className="px-3 py-1.5 text-sm border border-[var(--brand-border)] rounded bg-[var(--brand-bg)] text-[var(--brand-text)]"
          disabled={creating}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="px-3 py-1.5 text-sm font-medium rounded bg-[var(--brand-accent)] text-[var(--brand-accent-text,white)] hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setError(null);
          }}
          className="px-3 py-1.5 text-sm font-medium rounded border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        >
          Cancel
        </button>
      </div>
      {error && <p className="w-full text-sm text-red-500">{error}</p>}
    </form>
  );
}

/* ── Main page ── */
export default function ReferralsPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [links, setLinks] = useState<ReferralLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMyLinks();
      setLinks(data.links);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load referral links",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchLinks();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [isAuthenticated, authLoading, fetchLinks]);

  const handleUpdateSlug = async (linkId: number, newSlug: string) => {
    await updateLink(linkId, { slug: newSlug });
    await fetchLinks();
  };

  const handleDelete = async (linkId: number) => {
    if (!confirm("Delete this link? The URL will stop working.")) return;
    try {
      await deleteLink(linkId);
      await fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete link");
    }
  };

  const defaultLink = links.find((l) => l.is_default);
  const campaignLinks = links.filter((l) => !l.is_default);

  // Not authenticated
  if (!authLoading && !isAuthenticated) {
    return (
      <Layout>
        <div className="py-12 text-center">
          <LinkIcon className="w-12 h-12 mx-auto mb-4 text-[var(--brand-text-muted)]" />
          <h1
            className="text-2xl font-bold mb-2"
            style={{ fontFamily: "var(--brand-font-display)" }}
          >
            Referrals
          </h1>
          <p className="text-[var(--brand-text-muted)] mb-6">
            Sign in to get your referral link and track who you've invited.
          </p>
          <button
            onClick={() => login()}
            className="inline-flex items-center px-5 py-2.5 rounded-lg text-sm font-semibold
              bg-[var(--brand-accent)] text-[var(--brand-accent-text,white)] hover:opacity-90 transition-opacity"
          >
            Sign in with Discord
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="py-8 max-w-2xl mx-auto">
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "var(--brand-font-display)" }}
        >
          Referrals
        </h1>
        <p className="text-sm text-[var(--brand-text-muted)] mb-6">
          Share your link to invite others to the course. Track how your
          referrals are doing.
        </p>

        {(loading || authLoading) && (
          <div className="text-[var(--brand-text-muted)] py-8 text-center">
            Loading...
          </div>
        )}

        {error && (
          <div className="mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {!loading && !authLoading && !error && (
          <div className="space-y-6">
            {/* ── Primary action: copy your link ── */}
            {defaultLink && (
              <section className="p-5 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-bg-muted,#f9fafb)] space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <code className="flex-1 text-sm sm:text-base break-all bg-[var(--brand-bg)] px-3 py-2 rounded-md border border-[var(--brand-border)]">
                    {linkUrl(defaultLink.slug)}
                  </code>
                  <CopyButton text={linkUrl(defaultLink.slug)} />
                </div>
                <div className="flex items-start gap-2">
                  <p className="text-sm text-[var(--brand-text-muted)] italic flex-1">
                    "{SHARE_MESSAGE(linkUrl(defaultLink.slug))}"
                  </p>
                  <CopyButton
                    text={SHARE_MESSAGE(linkUrl(defaultLink.slug))}
                    label="Copy Message"
                  />
                </div>
              </section>
            )}

            {/* ── All links with stats ── */}
            {links.length > 0 && (
              <section className="space-y-3">
                <h2
                  className="text-lg font-semibold"
                  style={{ fontFamily: "var(--brand-font-display)" }}
                >
                  Your Links
                </h2>

                {/* Default link card */}
                {defaultLink && (
                  <LinkCard
                    link={defaultLink}
                    onUpdateSlug={handleUpdateSlug}
                  />
                )}

                {/* Campaign link cards */}
                {campaignLinks.map((link) => (
                  <LinkCard
                    key={link.link_id}
                    link={link}
                    onUpdateSlug={handleUpdateSlug}
                    onDelete={handleDelete}
                  />
                ))}

                {/* New campaign link */}
                <CreateLinkForm onCreated={fetchLinks} />
              </section>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
