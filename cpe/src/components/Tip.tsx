import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";

/** A tooltip for an icon-only control. The control keeps its own aria-label; the tip is visual only. */
export function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="tip">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
