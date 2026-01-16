import Layout from "@/components/Layout";

export default function WithLayoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Layout>{children}</Layout>;
}
