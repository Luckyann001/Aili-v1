import { SkipLink } from "@/components/SkipLink";
import { TopBar } from "@/components/TopBar/TopBar";

export default function ShellLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SkipLink />
      <TopBar />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
