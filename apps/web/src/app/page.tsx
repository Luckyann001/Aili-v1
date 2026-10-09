import Image from "next/image";
import Link from "next/link";

// Placeholder until the M1 landing page. Development only.
export default function Home() {
  return (
    <main aria-label="AILI" style={{ padding: "var(--aili-space-8)", maxWidth: 720, margin: "0 auto" }}>
      <Image src="/logo/logo-horizontal-compact.svg" alt="AILI" width={235} height={80} priority />
      <p>Foundations build (M0). The product surfaces start in M1.</p>
      <p>
        <Link href="/preview">Open the design preview</Link>
      </p>
    </main>
  );
}
