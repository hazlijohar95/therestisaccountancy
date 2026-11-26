import { Select } from "@base-ui/react/select";
import { Toggle } from "@base-ui/react/toggle";
import { formatTime } from "../domain/courses.ts";
import { coverage, progressOf } from "../domain/progress.ts";
import { RATES, usePlayer } from "../player.tsx";
import { Link } from "../router.tsx";
import { useAppState } from "../state.tsx";
import { Cover } from "./Cover.tsx";
import { Tip } from "./Tip.tsx";
import { Back, Check, Forward } from "./Icons.tsx";
import { PlayButton } from "./PlayButton.tsx";
import { Ring } from "./Ring.tsx";
import { Scrubber } from "./Scrubber.tsx";

export function PlayerBar() {
  const player = usePlayer();
  const state = useAppState();
  const course = player.course;
  if (!course) return null;
  const p = progressOf(state, course);
  const heard = coverage(p, course);
  return (
    <div className="pbar" role="region" aria-label="Now playing" data-test="player-bar">
      <div className="pbar__line" aria-hidden>
        <span style={{ width: `${(player.time / course.duration) * 100}%` }} />
      </div>
      <Link href={`/course/${course.id}`} className="pbar__now">
        <Cover course={course} size="sm" />
        <span className="pbar__text">
          <span className="pbar__title">{course.title}</span>
          <span className="pbar__show">{course.show.title}</span>
        </span>
      </Link>
      <div className="pbar__center">
        <div className="pbar__controls">
          <Tip label="Back 15s">
            <button className="ghost-icon" onClick={() => player.seek(player.time - 15)} aria-label="Back 15 seconds">
              <Back width={24} height={24} />
            </button>
          </Tip>
          <PlayButton course={course} size="sm" />
          <Tip label="Forward 15s">
            <button className="ghost-icon" onClick={() => player.seek(player.time + 15)} aria-label="Forward 15 seconds">
              <Forward width={24} height={24} />
            </button>
          </Tip>
        </div>
        <div className="pbar__scrub">
          <span className="tnum">{formatTime(player.time)}</span>
          <Scrubber course={course} time={player.time} ranges={p.ranges} answered={p.checkpoints} onSeek={player.seek} compact />
          <span className="tnum">{formatTime(course.duration)}</span>
        </div>
      </div>
      <div className="pbar__right">
        <Toggle
          className="speed"
          pressed={player.handsFree}
          onPressedChange={player.setHandsFree}
          aria-label="Hands-free: review questions wait for the end of the episode"
          title="Hands-free: review questions wait for the end of the episode"
          data-test="hands-free"
        >
          {player.handsFree ? "Hands-free on" : "Hands-free off"}
        </Toggle>
        <SpeedSelect />
        <span className="pbar__heard" title="Share of the episode you have heard">
          <Ring slices={[{ value: heard, tone: "var(--cpe)" }]} total={1} size={28} stroke={4} />
          <span className="tnum">{Math.floor(heard * 100)}%</span>
        </span>
      </div>
      <div className="pbar__mobileplay">
        <PlayButton course={course} size="sm" />
      </div>
    </div>
  );
}

const RATE_ITEMS = RATES.map((r) => ({ value: r, label: `${r}×` }));

function SpeedSelect() {
  const player = usePlayer();
  return (
    <Select.Root
      items={RATE_ITEMS}
      value={player.rate}
      onValueChange={(v) => {
        if (v !== null) player.setRate(v);
      }}
    >
      <Select.Trigger className="speed" aria-label="Playback speed" data-test="rate">
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner side="top" sideOffset={8} alignItemWithTrigger={false} className="menu-positioner">
          <Select.Popup className="menu">
            <Select.List>
              {RATE_ITEMS.map((r) => (
                <Select.Item key={r.value} value={r.value} className="menu__item" data-test={`rate-${r.value}`}>
                  <Select.ItemText>{r.label}</Select.ItemText>
                  <Select.ItemIndicator className="menu__tick">
                    <Check width={16} height={16} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
