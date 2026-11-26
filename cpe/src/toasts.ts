import { Toast } from "@base-ui/react/toast";

/** One app-wide toast manager. Callers add toasts directly; the lazy toast layer subscribes to it. */
export const toasts = Toast.createToastManager();
