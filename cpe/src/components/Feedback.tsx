import { Toast } from "@base-ui/react/toast";
import { toasts } from "../toasts.ts";
import { Close } from "./Icons.tsx";

/** The toast layer: subscribes to the shared manager in toasts.ts. Mounted lazily beside the app. */
export function ToastLayer() {
  return (
    <Toast.Provider toastManager={toasts} limit={3} timeout={5000}>
      <ToastStack />
    </Toast.Provider>
  );
}

function ToastStack() {
  const { toasts: list } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="toasts">
        {list.map((t) => (
          <Toast.Root key={t.id} toast={t} className="toast" data-test="toast">
            <Toast.Content className="toast__content">
              <div className="toast__text">
                <Toast.Title className="toast__title" />
                <Toast.Description className="toast__desc" />
              </div>
              {t.actionProps && <Toast.Action className="toast__action" data-test="toast-action" />}
              <Toast.Close className="toast__close" aria-label="Dismiss">
                <Close width={16} height={16} />
              </Toast.Close>
            </Toast.Content>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
