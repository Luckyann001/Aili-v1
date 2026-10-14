import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";
import { readBlock, SELECTORS } from "@/design/contrast";
import { R3FCheck } from "./R3FCheck";
import { StatusIcon, type Status } from "@/components/StatusIcon";
import styles from "./preview.module.css";

export const metadata: Metadata = { title: "Design preview · AILI" };

// Local development page: tokens, fonts, logos and a renderer check. Not a product surface.

const GROUPS: Array<[string, string[]]> = [
  ["Backgrounds", ["bg", "bg-recessed", "surface"]],
  ["Text", ["text", "text-muted", "link"]],
  ["Action", ["action-bg", "action-bg-hover", "action-bg-pressed", "action-text"]],
  ["Accent and focus", ["accent", "focus-ring"]],
  ["Lines", ["border", "border-strong"]],
  ["Fills (3D materials too)", ["fill-explore", "fill-technical", "fill-discovery", "fill-expressive", "on-fill"]],
  ["Status and safety", ["status-pass-bg", "status-warn-bg", "status-fail-bg", "safety-bg", "safety-border"]],
];

const STATUSES: Array<{ status: Exclude<Status, "safety">; word: string; detail: string; className: string }> = [
  { status: "pass", word: "Pass", detail: "Torque margin above target", className: styles.statusPass! },
  { status: "warn", word: "Warn", detail: "Margin is thin", className: styles.statusWarn! },
  { status: "fail", word: "Fail", detail: "Load exceeds the rating", className: styles.statusFail! },
];

const LOGOS: Array<{ file: string; label: string; dark?: boolean; w: number; h: number }> = [
  { file: "logo-primary-outlined.svg", label: "Primary", w: 213, h: 220 },
  { file: "logo-primary-dark-outlined.svg", label: "Primary, dark background", dark: true, w: 213, h: 220 },
  { file: "logo-horizontal-outlined.svg", label: "Horizontal", w: 260, h: 75 },
  { file: "logo-horizontal-compact.svg", label: "Horizontal compact (navigation)", w: 235, h: 80 },
  { file: "logo-mark.svg", label: "Mark", w: 120, h: 120 },
  { file: "logo-icon.svg", label: "App icon", w: 120, h: 120 },
  { file: "favicon.svg", label: "Favicon", w: 48, h: 48 },
  { file: "logo-mono-ink-outlined.svg", label: "Mono, ink", w: 213, h: 220 },
  { file: "logo-mono-light-outlined.svg", label: "Mono, light (transparent)", dark: true, w: 213, h: 220 },
];

function loadTokens() {
  // `next dev` and `next build` run with apps/web as the working directory.
  const css = readFileSync(join(process.cwd(), "../../design/tokens.css"), "utf8");
  return { light: readBlock(css, SELECTORS.light), dark: readBlock(css, SELECTORS.dark) };
}

function ThemePanel({ theme, values }: { theme: "light" | "dark"; values: Record<string, string> }) {
  const label = theme === "light" ? "Light theme" : "Dark theme";
  return (
    <section data-theme={theme} className={styles.panel} aria-label={label}>
      <h2 className={styles.panelTitle}>{label}</h2>

      {GROUPS.map(([group, names]) => (
        <div key={group}>
          <h3 className={styles.groupTitle}>{group}</h3>
          <ul className={styles.swatches}>
            {names.map((n) => (
              <li key={n} className={styles.swatch}>
                <span className={styles.swatchColor} style={{ background: `var(--aili-${n})` }} />
                <span className={styles.swatchName}>{n}</span>
                <span className={styles.swatchHex}>{values[`--aili-${n}`]}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <h3 className={styles.groupTitle}>In use</h3>
      <div className={styles.samples}>
        <p>
          Body text in Ink. <span className={styles.muted}>Muted supporting text.</span> <a href="#fonts">A link</a>
        </p>
        <div className={styles.row}>
          <button type="button" className={styles.primaryButton}>
            Continue
          </button>
          <label className={styles.inputLabel}>
            Arm length (m)
            <input className={styles.input} defaultValue="0.20" inputMode="decimal" />
          </label>
        </div>

        <div className={styles.row}>
          <span className={styles.fill} style={{ background: "var(--aili-fill-explore)" }}>Sage</span>
          <span className={styles.fill} style={{ background: "var(--aili-fill-technical)" }}>Sky</span>
          <span className={styles.fill} style={{ background: "var(--aili-fill-discovery)" }}>Gold</span>
          <span className={styles.fillLarge} style={{ background: "var(--aili-fill-expressive)" }}>Plum</span>
        </div>
        <p className={styles.note}>Plum takes large text only (Ink on Plum is 3.55:1).</p>

        <ul className={styles.statusList} aria-label="Check states">
          {STATUSES.map((s) => (
            <li key={s.status} className={`${styles.status} ${s.className}`}>
              <StatusIcon status={s.status} />
              <strong>{s.word}</strong>
              <span>{s.detail}</span>
            </li>
          ))}
        </ul>

        <div className={styles.safety} role="note">
          <StatusIcon status="safety" />
          <div>
            <strong>Safety</strong>
            <p>Disconnect power before changing the wiring.</p>
          </div>
        </div>

        <hr className={styles.divider} />
        <p className={styles.note}>Above: decorative divider (border). Input edge: border-strong.</p>
      </div>
    </section>
  );
}

/**
 * Development page only: in production builds it is "not found" unless AILI_ENABLE_PREVIEW=1 is
 * set at build time (the main e2e build sets it). `next dev` always has it.
 */
const PREVIEW_ENABLED = process.env.NODE_ENV !== "production" || process.env.AILI_ENABLE_PREVIEW === "1";

export default function PreviewPage() {
  if (!PREVIEW_ENABLED) notFound();
  const tokens = loadTokens();
  return (
    <>
      <header className={styles.header}>
        <Image src="/logo/logo-horizontal-compact.svg" alt="AILI" width={188} height={64} priority />
        <div>
          <h1 className={styles.title}>Design preview</h1>
          <p className={styles.note}>M0 development page: tokens, type, logos and a 3D renderer check. Not a product surface.</p>
        </div>
      </header>

      <main className={styles.page}>
        <section aria-labelledby="themes-title">
          <h2 id="themes-title" className={styles.sectionTitle}>Colour tokens</h2>
          <div className={styles.themes}>
            <ThemePanel theme="light" values={tokens.light} />
            <ThemePanel theme="dark" values={tokens.dark} />
          </div>
        </section>

        <section id="fonts" aria-labelledby="fonts-title" className={styles.block}>
          <h2 id="fonts-title" className={styles.sectionTitle}>Type</h2>
          <p className={styles.display1}>Don’t just read about the world. Step inside it.</p>
          <p className={styles.display2}>Curiosity creates.</p>
          <p className={styles.display3}>
            <em>Newsreader italic</em>: why holding a weight far from your body is harder.
          </p>
          <p className={styles.ui}>
            Inter, UI text. Select a part to inspect it. The quick brown fox jumps over the lazy dog. 0123456789
          </p>
          <p className={styles.uiSmall}>Inter 14 px · labels, captions and controls</p>
          <p className={styles.mono}>torque_nm = (m_p · l + ½ · λ · l²) · g · cos θ</p>
        </section>

        <section aria-labelledby="logos-title" className={styles.block}>
          <h2 id="logos-title" className={styles.sectionTitle}>Logo set</h2>
          <p className={styles.note}>
            Served unchanged from design/logo. The app uses the -outlined versions: taglines are outlined from Inter, so
            they render the same with or without the font.
          </p>
          <ul className={styles.logos}>
            {LOGOS.map((l) => (
              <li key={l.file} className={l.dark ? styles.logoCellDark : styles.logoCell} data-theme={l.dark ? "dark" : "light"}>
                <Image loading="eager" src={`/logo/${l.file}`} alt={`AILI logo, ${l.label.toLowerCase()}`} width={l.w} height={l.h} />
                <span className={styles.logoName}>
                  {l.label} · {l.file}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="r3f-title" className={styles.block}>
          <h2 id="r3f-title" className={styles.sectionTitle}>3D renderer check</h2>
          <p className={styles.note}>React 19 + React Three Fiber + drei OrbitControls. Drag to orbit.</p>
          <R3FCheck />
        </section>
      </main>
    </>
  );
}
