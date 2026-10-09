import Image from "next/image";
import Link from "next/link";
import { AppMenu } from "./AppMenu";
import styles from "./TopBar.module.css";

/** Thin top bar from the stage layout doc: logo (→ Home) and menu. No mode dashboards. */
export function TopBar() {
  return (
    <header className={styles.bar}>
      <Link href="/home" className={styles.logo} aria-label="AILI home">
        <Image src="/logo/logo-horizontal-compact.svg" alt="" width={141} height={48} priority />
      </Link>
      <nav aria-label="Main">
        <AppMenu />
      </nav>
    </header>
  );
}
