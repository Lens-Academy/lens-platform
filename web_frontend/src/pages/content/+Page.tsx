import { useState, useEffect } from "react";
import { API_URL } from "@/config";

interface ContentItem {
  slug: string;
  title: string;
  type: "module" | "lens" | "article";
  parent_title?: string | null;
}

export default function ContentIndexPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/modules`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.modules ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const modules = items.filter((i) => i.type === "module");
  const lenses = items.filter((i) => i.type === "lens");
  const articles = items.filter((i) => i.type === "article");

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-[var(--brand-text-muted)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold text-[var(--brand-text)] mb-8">
        Content
      </h1>

      <section className="mb-10">
        <h2 className="text-lg font-medium text-[var(--brand-text-muted)] mb-4">
          Modules ({modules.length})
        </h2>
        <ul className="space-y-2">
          {modules.map((m) => (
            <li key={m.slug}>
              <a
                href={`/module/${m.slug}`}
                className="text-lens-orange-600 hover:text-lens-orange-700 hover:underline"
              >
                {m.parent_title ? `${m.parent_title}: ${m.title}` : m.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-medium text-[var(--brand-text-muted)] mb-4">
          Lenses ({lenses.length})
        </h2>
        <ul className="space-y-2">
          {lenses.map((l) => (
            <li key={l.slug}>
              <a
                href={`/${l.slug}`}
                className="text-lens-orange-600 hover:text-lens-orange-700 hover:underline"
              >
                {l.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {articles.length > 0 && (
        <section>
          <h2 className="text-lg font-medium text-[var(--brand-text-muted)] mb-4">
            Articles ({articles.length})
          </h2>
          <ul className="space-y-2">
            {articles.map((a) => (
              <li key={a.slug}>
                <a
                  href={`/${a.slug}`}
                  className="text-lens-orange-600 hover:text-lens-orange-700 hover:underline"
                >
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
