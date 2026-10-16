"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/Button";
import { ContentBadge, LiveContentBadge } from "@/components/ContentBadge";
import { useDemoLabels } from "@/turn/useDemoLabels";
import { useLearnUi, type SideView } from "@/state/learnUi";
import { explanationAt } from "@/lesson/runner";
import { useLesson } from "@/lesson/store";
import { useTurnLog, type LoggedTurn } from "@/turn/turnLog";
import { CalcIcon, CaptionText } from "./CalcText";
import { SAMPLE_EXPLANATION, SAMPLE_READINGS } from "./sampleContent";
import styles from "./learn.module.css";

const TABS: Array<{ view: SideView; label: string }> = [
  { view: "explanation", label: "Explanation" },
  { view: "library", label: "Library" },
];

/**
 * Right-hand text panel on desktop, bottom sheet on phones (stage layout doc §1).
 * Non-modal: the stage stays usable. Opening focuses the selected tab; Esc or Close returns
 * focus to the button that opened it. The tabs are the visible title (no repeated heading).
 */
export function SidePanel({ view, returnFocusTo }: { view: SideView; returnFocusTo: RefObject<HTMLButtonElement | null> }) {
  const openSide = useLearnUi((s) => s.openSide);
  const closeSide = useLearnUi((s) => s.closeSide);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  // Focus the selected tab when the panel first opens (not on later tab switches).
  useEffect(() => {
    tabs.current[TABS.findIndex((t) => t.view === view)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    closeSide();
    returnFocusTo.current?.focus();
  };

  const onTabKey = (e: KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    openSide(TABS[next]!.view);
    tabs.current[next]?.focus();
  };

  return (
    <aside
      id="learn-side"
      className={styles.side}
      aria-labelledby="learn-side-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <h2 id="learn-side-title" className={styles.srOnly}>
        Text panel
      </h2>
      <div className={styles.sideHeader}>
        <div role="tablist" aria-label="Text panel" className={styles.tabs}>
          {TABS.map((t, i) => (
            <button
              key={t.view}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`learn-tab-${t.view}`}
              aria-selected={view === t.view}
              aria-controls="learn-tabpanel"
              tabIndex={view === t.view ? 0 : -1}
              className={styles.tab}
              onClick={() => openSide(t.view)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button variant="quiet" onClick={close}>
          Close
        </Button>
      </div>

      <div id="learn-tabpanel" role="tabpanel" aria-labelledby={`learn-tab-${view}`} className={styles.sideBody}>
        {view === "explanation" ? <ExplanationView /> : <LibraryView />}
      </div>
    </aside>
  );
}

function ExplanationView() {
  const beats = useLesson((s) => s.beats);
  const status = useLesson((s) => s.status);
  const beatIndex = useLesson((s) => s.beatIndex);
  const turns = useTurnLog((s) => s.turns);
  // Turns (live, or the fake director's) take the panel while no prepared lesson is running.
  if (turns.length && status === "idle") return <TurnsView turns={turns} />;
  const lesson = beats && status !== "idle" ? explanationAt(beats, beatIndex) : null;
  if (beats && status !== "idle" && !lesson) {
    return (
      <>
        <p>
          <ContentBadge kind="prepared" />
        </p>
        <p className={styles.sampleNote}>Aili explains after you answer the question on the stage.</p>
      </>
    );
  }
  const e = lesson ?? SAMPLE_EXPLANATION;
  return (
    <>
      <p>
        <ContentBadge kind="prepared" />
      </p>
      <p className={styles.sampleNote}>
        {lesson ? "Prepared lesson text. Draft (not expert-reviewed)." : "Sample text for the layout. Not reviewed teaching content."}
      </p>
      <h3 className={styles.stepTitle}>{e.title}</h3>
      <p>{e.body}</p>
      <h4 className={styles.listTitle}>Assumptions</h4>
      <ul>
        {e.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <h4 className={styles.listTitle}>Where this stops applying</h4>
      <ul>
        {e.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * The current step by default (split attention, layout doc §1); earlier steps below, collapsed.
 * Every value is labelled with its unit and marked as calculated; no calculation ID is ever shown.
 */
function TurnsView({ turns }: { turns: LoggedTurn[] }) {
  const current = turns.at(-1)!;
  const earlier = turns.slice(0, -1).reverse();
  return (
    <>
      <TurnView turn={current} heading="This step" />
      {earlier.length > 0 && (
        <details className={styles.history}>
          <summary>Earlier steps ({earlier.length})</summary>
          {earlier.map((t, i) => (
            <TurnView key={t.rev} turn={t} heading={`Step ${earlier.length - i}`} />
          ))}
        </details>
      )}
    </>
  );
}

const fidelityText = (f: string) => {
  const t = f.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function TurnView({ turn, heading }: { turn: LoggedTurn; heading: string }) {
  const x = turn.explanation;
  // Interrupted (M4 slice 1): only the segments the learner saw, then "Stopped here."
  const stopped = turn.shown !== undefined && turn.shown < turn.lines.length;
  const lines = stopped ? turn.lines.slice(0, turn.shown) : turn.lines;
  const demoLabels = useDemoLabels();
  return (
    <div className={styles.turnStep}>
      <p className={styles.captionBadges}>
        {turn.source === "live" ? (
          <>
            <ContentBadge kind="live" />
            <LiveContentBadge demo={demoLabels} />
          </>
        ) : (
          <ContentBadge kind="fixture" />
        )}
      </p>
      <h3 className={styles.stepTitle}>{heading}</h3>
      {lines.map((l, i) => (
        <p key={i}>{l.parts ? <CaptionText parts={l.parts} /> : l.text}</p>
      ))}
      {stopped && <p className={styles.sampleNote}>Stopped here.</p>}
      {turn.question && !stopped && (
        <>
          <h4 className={styles.listTitle}>Question</h4>
          <p>{turn.question.parts ? <CaptionText parts={turn.question.parts} /> : turn.question.text}</p>
        </>
      )}
      {x.calculations.length > 0 && (
        <>
          <h4 className={styles.listTitle}>Calculated values</h4>
          {x.calculations.map((c, i) => (
            <div key={i} className={styles.calcBlock}>
              <p className={styles.sampleNote}>
                {c.title} · {fidelityText(c.fidelity)}
              </p>
              <dl className={styles.calcList}>
                {c.outputs.map((o) => (
                  <div key={o.label + o.unit}>
                    <dt>{o.label}</dt>
                    <dd>
                      <span className={styles.calc} data-calculated="">
                        <CalcIcon />
                        {o.value}
                        {o.unit && ` ${o.unit}`}
                        <span className={styles.srOnly}>, calculated</span>
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              {c.inputs.length > 0 && (
                <p className={styles.calcInputs}>
                  Using: {c.inputs.map((v) => `${v.label.toLowerCase()} ${v.value}${v.unit ? ` ${v.unit}` : ""}`).join(", ")}.
                </p>
              )}
            </div>
          ))}
        </>
      )}
      {x.evidence.length > 0 && (
        <>
          <h4 className={styles.listTitle}>Evidence</h4>
          <ul>
            {x.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {x.assumptions.length > 0 && (
        <>
          <h4 className={styles.listTitle}>Assumptions</h4>
          <ul>
            {x.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {x.limitations.length > 0 && (
        <>
          <h4 className={styles.listTitle}>Where this stops applying</h4>
          <ul>
            {x.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LibraryView() {
  return (
    <>
      <p className={styles.sampleNote}>
        Only verified readings will appear here. These cards are samples for the layout, not real sources.
      </p>
      <ul className={styles.readings}>
        {SAMPLE_READINGS.map((r) => (
          <li key={r.id} className={styles.reading}>
            <span className={styles.sampleTag}>Sample</span>
            <h3 className={styles.readingTitle}>{r.title}</h3>
            <p>{r.purpose}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
