import { useState, useEffect } from "react";
import { API_URL } from "@/config";

interface ContentItem {
  slug: string;
  title: string;
  type: "module" | "lens";
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

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-stone-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-semibold text-stone-900 mb-8">Content</h1>

      <section className="mb-10">
        <h2 className="text-lg font-medium text-stone-700 mb-4">
          Modules ({modules.length})
        </h2>
        <ul className="space-y-2">
          {modules.map((m) => (
            <li key={m.slug}>
              <a
                href={`/module/${m.slug}`}
                className="text-blue-700 hover:underline"
              >
                {m.title}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-medium text-stone-700 mb-4">
          Lenses ({lenses.length})
        </h2>
        <ul className="space-y-2">
          {lenses.map((l) => (
            <li key={l.slug}>
              <a
                href={`/${l.slug}`}
                className="text-blue-700 hover:underline"
              >
                {l.title}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
