import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import styles from "../public.module.css";

export const metadata: Metadata = { title: "Log in · AILI" };

// Placeholder until sign-in (slice 8): no form, no fields, nothing collected.
export default function LoginPage() {
  return (
    <div className={styles.wrap}>
      <h1>Log in</h1>
      <p className={styles.lead}>Sign-in opens with the beta. For now, you can try the demo lesson without an account.</p>
      <div className={styles.actions}>
        <ButtonLink href="/learn" variant="primary">
          Try the demo lesson
        </ButtonLink>
      </div>
    </div>
  );
}
