"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ContentBadge } from "@/components/ContentBadge";
import { Button } from "@/components/Button";
import { MODELS } from "@/scene/models";
import { INCLUDE_DRAFTS, sceneShown } from "@/scene/visibility";
import { useScene } from "@/scene/sceneStore";
import { useLearnUi, type SideView } from "@/state/learnUi";
import { saveConsent, setMuted, useMuted } from "@/voice/consent";
import { isBusy } from "@/voice/machine";
import type { RecognitionMode } from "@/voice/recognition";
import { cancelSpeech, isSpeechOutputSupported } from "@/voice/speech";
import { useVoice } from "@/voice/store";
import { useVoiceController } from "@/voice/useVoiceController";
import { useLesson } from "@/lesson/store";
import { useLessonPlayer } from "@/lesson/useLessonPlayer";
import { markLearnVisited } from "@/learn/visited";
import { FAKE_DIRECTOR } from "@/turn/flags";
import { useStageContent } from "@/turn/stageContent";
import { useDemoTurn } from "@/turn/useDemoTurn";
import { useLiveMode } from "@/turn/useLiveMode";
import { CaptionText } from "./CalcText";
import { CommandBar, type ChipOffer } from "./CommandBar";
import { EffortGauge } from "./scene/EffortGauge";
import { ConsentDialog } from "./ConsentDialog";
import { DemoControls, useDemoMode } from "./DemoControls";
import { IconTool } from "./IconTool";
import { LiveWelcome } from "./LiveWelcome";
import { PlaceholderBadge } from "./PlaceholderBadge";
import { Inspector } from "./scene/Inspector";
import { PartsMenu } from "./scene/PartsMenu";
import { SceneFallback } from "./scene/SceneFallback";
import { SceneLabels } from "./scene/SceneLabels";
import { SceneViewport } from "./scene/SceneViewport";
import { TorqueMargin } from "./scene/TorqueMargin";
import { EquationLabels, EquationList } from "./scene/EquationLabels";
import { SidePanel } from "./SidePanel";
import { VoiceButton, VoiceStatusLabel } from "./VoiceButton";
import styles from "./learn.module.css";

// Focus targets where Space already means something (typing, pressing, switching tabs).
const SPACE_OWNERS =
  'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [role="tab"], [role="button"], [role="textbox"], [role="checkbox"], [role="switch"], [role="option"], [role="listbox"]';

// Learn stage (M1). Replies are a prepared demo line, badged "Prepared". On Lucky's laptop with live
// mode on (`npm run dev:live`, docs/m3-live-browser-plan.md), typed messages go to the live professor
// instead: demo mode A, a centred "What do you want to learn?" over the dimmed stage, no prepared
// lesson offered, and no stage badge until a turn puts a scene on stage.
const LIVE_NOTE = "Live AI: your message goes to a real AI model, on test-fixture content only.";
export function LearnStage() {
  const side = useLearnUi((s) => s.side);
  const captionsOn = useLearnUi((s) => s.captionsOn);
  const toggleSide = useLearnUi((s) => s.toggleSide);
  const toggleCaptions = useLearnUi((s) => s.toggleCaptions);
  const caption = useVoice((s) => s.caption);
  const hint = useVoice((s) => s.hint);
  const error = useVoice((s) => s.error);
  const muted = useMuted();
  const demo = useDemoMode();
  const viewer = useScene((s) => s.viewer);
  const labelsOn = useScene((s) => s.labelsOn);
  const toggleLabels = useScene((s) => s.toggleLabels);
  const resetView = useScene((s) => s.resetView);
  const exploded = useScene((s) => s.exploded);
  const activeScene = useScene((s) => s.activeScene);
  const shown = sceneShown(activeScene);
  const toggleExploded = useScene((s) => s.toggleExploded);
  const focusParts = useCallback(
    () => document.querySelector<HTMLButtonElement>('section[aria-label="Stage"] button[aria-haspopup="listbox"]')?.focus(),
    [],
  );
  const safeArea = useRef<HTMLDivElement | null>(null);

  // Lets Home offer "Pick up where you left off" (a flag in this browser only).
  useEffect(markLearnVisited, []);
  const labelEls = useRef(new Map<string, HTMLElement>());

  const [text, setText] = useState("");
  const [consentMode, setConsentMode] = useState<RecognitionMode | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const onTranscript = useCallback(
    (t: string) => {
      setText(t);
      focusInput();
    },
    [focusInput],
  );
  // Remember what opened the notice, so dismissing it puts focus back there.
  const consentOpener = useRef<HTMLElement | null>(null);
  const askConsent = useCallback((mode: RecognitionMode) => {
    consentOpener.current = document.activeElement as HTMLElement | null;
    setConsentMode(mode);
  }, []);
  const voice = useVoiceController({ onTranscript, onUnsupported: focusInput, askConsent });
  useLessonPlayer(voice);
  // Live mode, from the server (null until it answers). It takes over the text box, so the
  // fake-director demo's case buttons are off (in live mode they would reach the real model).
  const live = useLiveMode();
  const [welcomeGone, setWelcomeGone] = useState(false);
  const scenePicked = useStageContent((s) => s.scenePicked);
  const wordsOnlyAnalogy = useStageContent((s) => s.wordsOnlyAnalogy);
  const showWelcome = live === true && !welcomeGone;
  // The bottom input takes over once the welcome has gone. Both boxes share inputRef, so this runs
  // after React has committed the swap (a frame callback could still find the welcome's input).
  useLayoutEffect(() => {
    if (welcomeGone) inputRef.current?.focus();
  }, [welcomeGone]);
  // Live mode: the stage is dimmed, with no badge or scene tools, until a turn picks a scene.
  const dimmed = live === true && !scenePicked;
  const sceneUi = shown && !dimmed;
  // Fake-director demo (testing only): ?demo=1 in a build with both testing flags.
  const fakeDemo = demo && FAKE_DIRECTOR && live === false;
  const demoTurn = useDemoTurn(voice, live === true, setText);
  const lessonStatus = useLesson((s) => s.status);
  const lessonChoices = useLesson((s) => s.choices);
  const lessonRev = useLesson((s) => s.rev);
  const voicePrompt = useVoice((s) => s.prompt);
  const busy = isBusy(useVoice((s) => s.status));

  // Loads (and validates) the lesson on first use, then starts or continues it.
  const runLesson = useCallback(async (how: "start" | "resume") => {
    const l = useLesson.getState();
    if (!l.beats) {
      const { loadBeginnerLever } = await import("@/lesson/loadLesson");
      const loaded = loadBeginnerLever();
      if ("errors" in loaded) {
        const drafts = !INCLUDE_DRAFTS;
        const text = drafts
          ? "This lesson isn't available yet: its scenes are drafts that haven't been expert-reviewed."
          : "This lesson couldn't load because its content didn't pass the checks.";
        useLesson.getState().setUnavailable(text);
        useVoice.getState().setHint({ text, kind: "info" });
        return;
      }
      useLesson.getState().setScript(loaded.beats, loaded.title);
    }
    if (how === "start") useStageContent.getState().setFixture(false); // the lesson takes the stage
    useLesson.getState().dispatch({ type: how });
  }, []);

  // One open question at a time: the lesson's choices while it waits; otherwise Aili's quick
  // replies; otherwise an offer to start or continue the lesson (never in live mode; until the server
  // answers, the prepared page shows as usual, so a normal page load never shifts).
  const offer: ChipOffer | null =
    lessonStatus === "awaiting" && lessonChoices
      ? { group: "Suggested replies", items: lessonChoices, onPick: (id) => useLesson.getState().dispatch({ type: "choose", rev: lessonRev, choice: id }) }
      : voicePrompt || busy || lessonStatus === "playing" || live === true
        ? null
        : lessonStatus === "stopped"
          ? { group: "Lesson", items: [{ id: "resume", label: "Continue the lesson" }], onPick: () => void runLesson("resume") }
          : { group: "Lesson", items: [{ id: "start", label: lessonStatus === "done" ? "Start the lesson again" : "Start: why reach makes holding harder" }], onPick: () => void runLesson("start") };

  const open = (view: SideView, el: HTMLButtonElement) => {
    lastTrigger.current = el;
    toggleSide(view);
  };

  // Space starts/stops voice only when focus is not on something that uses Space itself.
  // Escape interrupts while Aili is busy (inside the text panel, Escape closes the panel instead).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Element | null;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === " " && !e.repeat && !t?.closest(SPACE_OWNERS)) {
        e.preventDefault();
        void voice.press();
      } else if (e.key === "Escape" && isBusy(useVoice.getState().status) && !t?.closest("aside")) {
        voice.interrupt();
      } else if (e.key === "Escape" && useScene.getState().inspectorOpen && !t?.closest("aside")) {
        // Escape closes the inspector (after interrupting Aili, which takes priority).
        useScene.getState().closeInspector();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [voice]);

  // Captions are announced to screen readers only when Aili's voice is not audible.
  const captionLive = muted || !isSpeechOutputSupported() ? "polite" : "off";

  return (
    <div className={styles.learn} data-side={side ?? "closed"}>
      <h1 className={styles.srOnly}>Learn stage</h1>
      <section className={styles.stage} aria-label="Stage" data-dimmed={dimmed ? "" : undefined}>
        {shown && <SceneViewport safeArea={safeArea} labels={labelEls} />}

        <div className={styles.stageTop}>
          <div className={styles.topRow}>
            <div className={styles.topLeft}>
              {sceneUi && <PlaceholderBadge />}
              {sceneUi && <PartsMenu />}
            </div>
            <div className={styles.sceneTools} role="group" aria-label="View">
              {sceneUi && <IconTool label="Labels" icon={<LabelIcon />} aria-pressed={labelsOn} onClick={toggleLabels} />}
              {sceneUi && MODELS[activeScene].explodable && (
                <IconTool label="Exploded view" icon={<ExplodeIcon />} aria-pressed={exploded} onClick={toggleExploded} />
              )}
              {sceneUi && <IconTool label="Reset view" icon={<ResetIcon />} onClick={resetView} />}
              <IconTool
                label="Explanation"
                icon={<TextIcon />}
                aria-expanded={side === "explanation"}
                aria-controls="learn-side"
                onClick={(e) => open("explanation", e.currentTarget)}
              />
            </div>
          </div>
        </div>

        {demo && <DemoControls onPlay={() => voice.submit("demo")} onFakeTurn={fakeDemo ? (c) => void demoTurn.start(c, "") : undefined} />}

        {/* Safe area: the model is framed here and labels never leave it (so they can't cover controls). */}
        <div ref={safeArea} className={styles.scene} data-safe-area="">
          {!shown ? (
            // Production without the dev flag: draft scenes are hidden, and we say so plainly.
            <p className={styles.sceneLoading}>No expert-reviewed scene is available yet.</p>
          ) : (
            <>
              {/* The still picture shows at once; the 3D view replaces it in the same place when ready. */}
              {viewer === "loading" && <SceneFallback loading />}
              {viewer === "fallback" && <SceneFallback />}
              {viewer === "ready" && <SceneLabels labels={labelEls} />}
              {viewer === "ready" && <EquationLabels labels={labelEls} />}
              {viewer === "fallback" && <EquationList />}
              <Inspector onClosed={focusParts} />
              <EffortGauge />
              <TorqueMargin />
            </>
          )}
        </div>

        {showWelcome && (
          <LiveWelcome
            note={LIVE_NOTE}
            text={text}
            onText={setText}
            inputRef={inputRef}
            onSubmit={(t) => void demoTurn.start("valid", t)}
            onGone={() => setWelcomeGone(true)}
          />
        )}

        <div className={styles.overlay}>
          {(hint || error) && (
            <p className={styles.voiceMessage} data-kind={error ? "error" : hint!.kind} role={error || hint?.kind === "error" ? "alert" : undefined}>
              {error ?? hint!.text}
            </p>
          )}
          {captionsOn && caption && (
            <div className={styles.caption}>
              {caption.source === "live" ? (
                // A live answer on test-fixture content carries both labels.
                <span className={styles.captionBadges}>
                  <ContentBadge kind="live" />
                  <ContentBadge kind="fixture-content" />
                </span>
              ) : (
                <ContentBadge kind={caption.source === "fixture" ? "fixture" : "prepared"} />
              )}
              <p aria-live={captionLive}>{caption.parts ? <CaptionText parts={caption.parts} /> : caption.text}</p>
            </div>
          )}
          {/* Shown whether or not captions are on: the stage is not a picture of this analogy. */}
          {wordsOnlyAnalogy && (
            <p className={styles.analogyNote} data-analogy-note="">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M2.5 4h9M2.5 7h9M2.5 10h5.5" />
              </svg>
              Analogy in words only. No picture of this yet.
              <span className={styles.srOnly}> ({wordsOnlyAnalogy.replace(/\s*\(test fixture\)$/, "")})</span>
            </p>
          )}
        </div>

        <div className={styles.stageBottom}>
          <div className={styles.stageGroup}>
            <Button variant="secondary" aria-pressed={captionsOn} onClick={toggleCaptions}>
              <CaptionIcon />
              <span className={styles.btnLabel}>Captions</span>
            </Button>
            <Button
              variant="secondary"
              aria-pressed={muted}
              onClick={() => {
                setMuted(!muted);
                if (!muted) cancelSpeech(); // captions keep running on their timers
              }}
            >
              <MuteIcon muted={muted} />
              <span className={styles.btnLabel}>Mute</span>
            </Button>
          </div>
          <div className={styles.voiceSlot}>
            <VoiceButton placement="stage" onPress={() => void voice.press()} />
            <VoiceStatusLabel />
          </div>
          <Button
            variant="secondary"
            aria-expanded={side === "library"}
            aria-controls="learn-side"
            onClick={(e) => open("library", e.currentTarget)}
          >
            <BookIcon />
            <span className={styles.btnLabel}>Library</span>
          </Button>
        </div>
      </section>

      {!showWelcome && (
      <CommandBar
        text={text}
        onText={setText}
        onSubmit={
          live
            ? (t) => void demoTurn.start("valid", t) // the case is ignored by the live route
            : fakeDemo
              ? (t) => void demoTurn.start("valid", t)
              : voice.submit
        }
        note={live ? LIVE_NOTE : fakeDemo ? "Scripted reply: it does not respond to what you typed." : undefined}
        chipsSend={live === true}
        onVoice={() => void voice.press()}
        inputRef={inputRef}
        offer={offer}
      />
      )}

      {side && <SidePanel view={side} returnFocusTo={lastTrigger} />}

      {consentMode && (
        <ConsentDialog
          mode={consentMode}
          onClose={(result) => {
            setConsentMode(null);
            if (result === "voice") {
              saveConsent("voice", consentMode);
              consentOpener.current?.focus();
              voice.startListening(consentMode);
            } else if (result === "text") {
              saveConsent("text", consentMode);
              focusInput();
            } else {
              consentOpener.current?.focus(); // dismissed: nothing saved
            }
          }}
        />
      )}
    </div>
  );
}

function TextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 4h12M3 8h12M3 12h8" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M2.5 3.5h5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 0-1.5-1.5h-5zM15.5 3.5h-5A1.5 1.5 0 0 0 9 5v10a1.5 1.5 0 0 1 1.5-1.5h5z" />
    </svg>
  );
}

function CaptionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M8.5 8.6a1.8 1.8 0 1 0 0 2.8M14 8.6a1.8 1.8 0 1 0 0 2.8" strokeLinecap="round" />
    </svg>
  );
}

function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" />
      {muted ? <path d="M13.5 7.5l4 5M17.5 7.5l-4 5" /> : <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" />}
    </svg>
  );
}

function LabelIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M3 4.5h9l5 5.5-5 5.5H3z" />
      <circle cx="7" cy="10" r="1.3" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10a6 6 0 1 0 2-4.5M4 3.5v3h3" />
    </svg>
  );
}

function ExplodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="8" height="3.5" rx="1" />
      <rect x="6" y="8.25" width="8" height="3.5" rx="1" />
      <rect x="6" y="14.5" width="8" height="3.5" rx="1" />
      <path d="M3 6.5v7M17 6.5v7" />
    </svg>
  );
}
