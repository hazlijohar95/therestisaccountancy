import { Button } from "@base-ui/react/button";
import type { MouseEvent } from "react";
import type { Course } from "../domain/types.ts";
import { usePlayer } from "../player.tsx";
import { Pause, Play } from "./Icons.tsx";

/** The sub-brand's one job: start or stop listening. Safe inside links: it never follows them. */
export function PlayButton({ course, size = "md", at }: { course: Course; size?: "sm" | "md" | "lg"; at?: number }) {
  const player = usePlayer();
  const playing = player.course?.id === course.id && player.playing;
  const px = size === "lg" ? 28 : size === "md" ? 22 : 16;
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (player.course?.id === course.id && at === undefined) player.toggle();
    else player.play(course, at);
  };
  return (
    <Button
      className={`play play--${size}${playing ? " play--on" : ""}`}
      onClick={onClick}
      aria-label={`${playing ? "Pause" : "Play"} ${course.title}`}
      data-test={`play-${course.id}`}
    >
      {playing ? <Pause width={px} height={px} /> : <Play width={px} height={px} />}
    </Button>
  );
}
