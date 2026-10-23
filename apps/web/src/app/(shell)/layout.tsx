import { SkipLink } from "@/components/SkipLink";
import { TopBar } from "@/components/TopBar/TopBar";
import styles from "./shell.module.css";

export default function ShellLayout({ children }: LayoutProps<"/">) {
  return (
    <div className={styles.shell}>
      <SkipLink />
      <TopBar />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  );
}
