import { ButtonLink } from "@/components/Button";
import { ComingTag } from "@/components/ComingTag";
import { demoLessonShown } from "@/scene/visibility";
import { StatusNote } from "@/components/StatusNote";
import styles from "./public.module.css";

// Landing: AILI as a platform. Robotics is the only subject; nothing unbuilt is promised.
const common = { width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const STEPS = [
  {
    name: "Understand",
    text: "Aili explains the idea plainly, then checks what you took from it.",
    fill: "technical",
    // Speech bubble.
    icon: <path d="M4 5h16v11H10l-4 3v-3H4z" />,
  },
  {
    name: "See it",
    text: "Look at the parts in 3D: turn them, label them, pull them apart.",
    fill: "explore",
    // Cube.
    icon: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  },
  {
    name: "Try it",
    text: "Change something and watch what happens.",
    fill: "discovery",
    // Slider.
    icon: <path d="M4 12h16M9 8v8" />,
  },
  {
    name: "Build",
    text: "Turn what you learned into a real project, step by step.",
    fill: "expressive",
    coming: true,
    // Wrench.
    icon: <path d="M14.5 4a4.5 4.5 0 0 0-4.2 6.1L4 16.4 7.6 20l6.3-6.3A4.5 4.5 0 0 0 20 9.5l-2.8 2.8-3.5-3.5L16.5 6A4.5 4.5 0 0 0 14.5 4z" />,
  },
] as const;

export default function Landing() {
  const lessonReady = demoLessonShown();
  return (
    <div className={styles.wrap}>
      <section aria-labelledby="hero" className={styles.hero}>
        <h1 id="hero">Understand a hard topic. Then build with it.</h1>
        <p className={styles.lead}>AILI is a one-to-one learning environment for complex technical topics.</p>
        <p className={styles.lead}>You understand the idea, see it in 3D, try it for yourself, and then build with it.</p>
        <StatusNote>Early beta. Lessons are prepared demos; the live professor is not connected yet.</StatusNote>
        <div className={styles.actions}>
          <ButtonLink href="/learn" variant="primary">
            Try the demo lesson
          </ButtonLink>
          <ButtonLink href="/login">Log in</ButtonLink>
        </div>
        {!lessonReady && <p className={styles.note}>The demo lesson is waiting for expert review.</p>}
        <p className={styles.note}>Beta by invitation. Waitlist coming.</p>
      </section>

      <section aria-labelledby="robotics">
        <h2 id="robotics">Starting with robotics</h2>
        <p>Robotics is the first subject. The demo lesson shows why a weight gets harder to hold the further out it sits, and what that means for a robot arm.</p>
        <p>
          More subjects later <ComingTag />
        </p>
      </section>

      <section aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className={styles.steps}>
          {STEPS.map((s) => (
            <li key={s.name} className={styles.step}>
              <span className={`${styles.stepIcon} ${styles[`fill_${s.fill}`]}`}>
                <svg {...common}>{s.icon}</svg>
              </span>
              <span>
                <span className={styles.stepName}>
                  {s.name} {"coming" in s && <ComingTag />}
                </span>
                <span className={styles.stepText}>{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
