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
  Pencil,
  Trash2,
  Plus,
  Link as LinkIcon,
} from "lucide-react";

const BASE_URL =
  typeof window !== "undefined" ? window.location.origin : "https://lensacademy.ai";

const SHARE_MESSAGE = (url: string) =>
  `Check out this free AI Safety course! ${url}`;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
        bg-[var(--brand-accent)] text-[var(--brand-accent-text,white)]
        hover:opacity-90 transition-opacity"
      title="Copy to clipboard"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4" />
          Copied!
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          Copy
        </>
      )}
    </button>
  );
}

function SlugEditor({
  link,
  onSave,
}: {
  link: ReferralLink;
  onSave: (linkId: number, slug: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(link.slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!slug.trim() || slug === link.slug) {
      setEditing(false);
      setSlug(link.slug);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(link.link_id, slug.trim());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update slug");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSlug(link.slug);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <code className="text-sm bg-[var(--brand-bg-muted,#f3f4f6)] px-1.5 py-0.5 rounded">
          /ref/{link.slug}
        </code>
        <button
          onClick={() => setEditing(true)}
          className="p-1 rounded hover:bg-[var(--brand-bg-muted,#f3f4f6)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
          title="Edit slug"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm text-[var(--brand-text-muted)]">/ref/</span>
      <input
        type="text"
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        className="text-sm px-2 py-0.5 border border-[var(--brand-border)] rounded bg-[var(--brand-bg)] text-[var(--brand-text)] w-32"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") handleCancel();
        }}
        disabled={saving}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-2 py-0.5 text-xs font-medium rounded bg-[var(--brand-accent)] text-[var(--brand-accent-text,white)] hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "..." : "Save"}
      </button>
      <button
        onClick={handleCancel}
        disabled={saving}
        className="px-2 py-0.5 text-xs font-medium rounded border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] disabled:opacity-50"
      >
        Cancel
      </button>
      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </span>
  );
}

function CreateLinkForm({
  onCreated,
}: {
  onCreated: () => void;
}) {
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
        Create campaign link
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 p-4 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-bg-muted,#f9fafb)]">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[var(--brand-text-muted)]">
          Campaign name *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Twitter Bio"
          className="px-3 py-1.5 text-sm border border-[var(--brand-border)] rounded bg-[var(--brand-bg)] text-[var(--brand-text)]"
          required
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
          onClick={() => { setExpanded(false); setError(null); }}
          className="px-3 py-1.5 text-sm font-medium rounded border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="w-full text-sm text-red-500">{error}</p>
      )}
    </form>
  );
}

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
      setError(err instanceof Error ? err.message : "Failed to load referral links");
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
    if (!confirm("Delete this referral link? This cannot be undone.")) return;
    try {
      await deleteLink(linkId);
      await fetchLinks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete link");
    }
  };

  const defaultLink = links.find((l) => l.is_default);
  const totals = links.reduce(
    (acc, l) => ({
      clicks: acc.clicks + l.clicks,
      signups: acc.signups + l.signups,
      enrolled: acc.enrolled + l.enrolled,
      completed: acc.completed + l.completed,
    }),
    { clicks: 0, signups: 0, enrolled: 0, completed: 0 },
  );

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
      <div className="py-8 max-w-3xl mx-auto">
        <h1
          className="text-2xl font-bold mb-6"
          style={{ fontFamily: "var(--brand-font-display)" }}
        >
          Your Referral Links
        </h1>

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
          <>
            {/* Default link - prominent display */}
            {defaultLink && (
              <section className="mb-8 p-5 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-bg-muted,#f9fafb)]">
                <h2 className="text-sm font-semibold text-[var(--brand-text-muted)] uppercase tracking-wide mb-3">
                  Your referral link
                </h2>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <code className="text-base font-medium bg-[var(--brand-bg)] px-3 py-1.5 rounded-md border border-[var(--brand-border)] break-all">
                    {BASE_URL}/ref/{defaultLink.slug}
                  </code>
                  <CopyButton text={`${BASE_URL}/ref/${defaultLink.slug}`} />
                </div>
                <div className="mt-3">
                  <p className="text-xs font-medium text-[var(--brand-text-muted)] mb-1">
                    Share message:
                  </p>
                  <div className="flex items-start gap-2">
                    <p className="text-sm text-[var(--brand-text-muted)] italic flex-1">
                      "{SHARE_MESSAGE(`${BASE_URL}/ref/${defaultLink.slug}`)}"
                    </p>
                    <CopyButton
                      text={SHARE_MESSAGE(`${BASE_URL}/ref/${defaultLink.slug}`)}
                    />
                  </div>
                </div>
              </section>
            )}

            {/* Stats table */}
            {links.length > 0 && (
              <section className="mb-8">
                <h2
                  className="text-lg font-semibold mb-3"
                  style={{ fontFamily: "var(--brand-font-display)" }}
                >
                  Stats
                </h2>
                <div className="overflow-x-auto rounded-lg border border-[var(--brand-border)]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--brand-bg-muted,#f3f4f6)] text-left">
                        <th className="px-4 py-2.5 font-semibold text-[var(--brand-text-muted)]">
                          Link
                        </th>
                        <th className="px-4 py-2.5 font-semibold text-[var(--brand-text-muted)] text-right">
                          Clicks
                        </th>
                        <th className="px-4 py-2.5 font-semibold text-[var(--brand-text-muted)] text-right">
                          Signups
                        </th>
                        <th className="px-4 py-2.5 font-semibold text-[var(--brand-text-muted)] text-right">
                          Enrolled
                        </th>
                        <th className="px-4 py-2.5 font-semibold text-[var(--brand-text-muted)] text-right">
                          Completed
                        </th>
                        <th className="px-4 py-2.5 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {links.map((link, i) => (
                        <tr
                          key={link.link_id}
                          className={
                            i % 2 === 0
                              ? "bg-[var(--brand-bg)]"
                              : "bg-[var(--brand-bg-muted,#f9fafb)]"
                          }
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium">{link.name}</span>
                              <SlugEditor
                                link={link}
                                onSave={handleUpdateSlug}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {link.clicks}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {link.signups}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {link.enrolled}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {link.completed}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {!link.is_default && (
                              <button
                                onClick={() => handleDelete(link.link_id)}
                                className="p-1 rounded hover:bg-red-50 text-[var(--brand-text-muted)] hover:text-red-600 transition-colors"
                                title="Delete link"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      {links.length > 1 && (
                        <tr className="border-t-2 border-[var(--brand-border)] font-semibold bg-[var(--brand-bg-muted,#f3f4f6)]">
                          <td className="px-4 py-2.5">Total</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {totals.clicks}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {totals.signups}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {totals.enrolled}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {totals.completed}
                          </td>
                          <td className="px-4 py-2.5" />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Campaign link creation */}
            <section>
              <h2
                className="text-lg font-semibold mb-3"
                style={{ fontFamily: "var(--brand-font-display)" }}
              >
                Campaign Links
              </h2>
              <p className="text-sm text-[var(--brand-text-muted)] mb-4">
                Create separate links to track different channels (social media,
                email, blog posts, etc.).
              </p>
              <CreateLinkForm onCreated={fetchLinks} />
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
