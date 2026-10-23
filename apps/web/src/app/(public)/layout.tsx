import { SkipLink } from "@/components/SkipLink";
import { PublicTopBar } from "@/components/TopBar/PublicTopBar";
import styles from "./public.module.css";

export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SkipLink />
      <PublicTopBar />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </>
  );
}
