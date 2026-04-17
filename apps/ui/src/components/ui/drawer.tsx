import type { ReactNode } from "react";
import { Button } from "./button";

type DrawerProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

export function Drawer({ title, eyebrow, description, actions, children, onClose }: DrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 border-b border-stone-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {eyebrow ? <p className="text-xs uppercase tracking-wide text-stone-500">{eyebrow}</p> : null}
              <h3 className="text-lg font-semibold">{title}</h3>
              {description ? <div className="mt-1 text-sm text-stone-600">{description}</div> : null}
            </div>
            <Button variant="outline" size="sm" type="button" onClick={onClose}>
              Close
            </Button>
          </div>
          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        <div className="space-y-3 p-3">{children}</div>
      </aside>
    </div>
  );
}
