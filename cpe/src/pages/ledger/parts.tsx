import { Checkbox } from "@base-ui/react/checkbox";
import { Dialog } from "@base-ui/react/dialog";
import { NumberField } from "@base-ui/react/number-field";
import type { ReactNode } from "react";
import { Check, Close } from "../../components/Icons.tsx";
import { toasts as toast } from "../../toasts.ts";

/** Runs a ledger change on the server and says so if it fails. */
export const saving = (work: Promise<void>) =>
  work.catch((e: unknown) => {
    toast.add({ title: "Not saved", description: e instanceof Error ? e.message : "Try again." });
  });

/** A Base UI dialog shell shared by the ledger forms. */
export function Sheet({ trigger, title, open, onOpenChange, children }: { trigger: ReactNode; title: string; open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger}
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="sheet">
            <div className="sheet__head">
              <Dialog.Title className="sheet__title">{title}</Dialog.Title>
              <Dialog.Close className="ghost-icon" aria-label="Close">
                <Close />
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Stepper({ label, value, onChange, step = 0.5, min = 0, max, plain = false, test }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; max?: number; plain?: boolean; test?: string }) {
  return (
    <NumberField.Root value={value} onValueChange={onChange} min={min} max={max} step={step} format={plain ? { useGrouping: false } : undefined} className="numfield">
      <NumberField.Group className="numfield__group">
        <NumberField.Decrement className="numfield__btn" aria-label={`Decrease ${label}`}>
          −
        </NumberField.Decrement>
        <NumberField.Input className="numfield__input" aria-label={label} data-test={test} />
        <NumberField.Increment className="numfield__btn" aria-label={`Increase ${label}`}>
          +
        </NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

/** The tick a member sets once an entry is in MIA's portal. */
export function PortalTick({ checked, onChange, title, labelled = false }: { checked: boolean; onChange: (checked: boolean) => void; title: string; labelled?: boolean }) {
  return (
    <label className="tick-row">
      <Checkbox.Root checked={checked} onCheckedChange={onChange} className="checkbox" aria-label={`${title}: entered in MIA portal`} data-test="declared">
        <Checkbox.Indicator className="checkbox__mark">
          <Check width={14} height={14} />
        </Checkbox.Indicator>
      </Checkbox.Root>
      {labelled && <span>Entered</span>}
    </label>
  );
}
