import "../styles/globals.css";
import { Providers } from "@/components/Providers";
import { GlobalComponents } from "@/components/GlobalComponents";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {children}
      <GlobalComponents />
    </Providers>
  );
}
