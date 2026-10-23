import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import styles from "./TopBar.module.css";

/** Top bar for the public pages (landing, login): logo (→ /) and Log in. No app menu before sign-in. */
export function PublicTopBar() {
  return (
    <header className={styles.bar}>
      <Link href="/" className={styles.logo} aria-label="AILI">
        <Image className={styles.logoLight} src="/logo/logo-horizontal-compact.svg" alt="" width={141} height={48} priority />
        <Image className={styles.logoDark} src="/logo/logo-horizontal-compact-dark.svg" alt="" width={141} height={48} priority />
      </Link>
      <nav aria-label="Main">
        <ButtonLink href="/login">Log in</ButtonLink>
      </nav>
    </header>
  );
}
