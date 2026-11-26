import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useEffect, useState } from "react";
import type { Course } from "../domain/types.ts";
import { usePlayer } from "../player.tsx";
import { useDispatch } from "../state.tsx";
import { Check } from "./Icons.tsx";

const LETTERS = ["A", "B", "C", "D"];

/**
 * Review questions interrupt the episode where the idea lands. The dialog can't be dismissed:
 * the only way on is a correct answer. They teach; they don't grade.
 */
export function CheckpointCard() {
  const { course, pending, clearPending } = usePlayer();
  const dispatch = useDispatch();
  // Keep the last question so its content stays on screen through the exit animation.
  const [shown, setShown] = useState<{ course: Course; index: number } | null>(null);
  const [choice, setChoice] = useState<number | null>(null);

  useEffect(() => {
    if (course && pending !== null) {
      setShown({ course, index: pending });
      setChoice(null);
    }
  }, [course, pending]);

  const open = pending !== null;
  const cp = shown ? shown.course.checkpoints[shown.index] : undefined;
  const correct = cp !== undefined && choice === cp.answer;

  const pick = (i: number | null) => {
    if (!shown || !cp || i === null || correct) return;
    setChoice(i);
    if (i === cp.answer) dispatch({ type: "checkpoint", courseId: shown.course.id, index: shown.index });
  };

  return (
    <Dialog.Root
      open={open}
      disablePointerDismissal
      onOpenChange={(next, d) => {
        if (!next) d.cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="checkpoint__card" data-test="checkpoint">
            {shown && cp && (
              <>
                <span className="tape checkpoint__tape">
                  Question {shown.index + 1} of {shown.course.checkpoints.length}
                </span>
                <p className="eyebrow">Paused · {shown.course.title}</p>
                <Dialog.Title className="checkpoint__prompt" id="cp-prompt">
                  {cp.prompt}
                </Dialog.Title>
                <RadioGroup className="options" value={choice} onValueChange={pick} readOnly={correct} aria-labelledby="cp-prompt">
                  {cp.options.map((o, i) => {
                    const state = choice === null ? "idle" : i === cp.answer && correct ? "right" : i === choice ? "wrong" : "idle";
                    return (
                      <label key={o} className={`option option--${state}`} data-test={`cp-option-${i}`}>
                        <Radio.Root value={i} className="option__key">
                          {LETTERS[i]}
                        </Radio.Root>
                        <span>{o}</span>
                        {state === "right" && <Check className="option__tick" />}
                      </label>
                    );
                  })}
                </RadioGroup>
                <div role="status" className={choice === null ? undefined : `feedback feedback--${correct ? "right" : "wrong"}`}>
                  {choice !== null && (
                    <>
                      <strong>{correct ? "Correct." : "Not quite."}</strong> {correct ? cp.why : "Try again. It doesn’t count against you."}
                    </>
                  )}
                </div>
                <div className="checkpoint__actions">
                  {correct ? (
                    <Button className="pill pill--cpe" onClick={clearPending} data-test="cp-continue">
                      Continue listening
                    </Button>
                  ) : (
                    <span className="muted">Answer to keep listening.</span>
                  )}
                </div>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
