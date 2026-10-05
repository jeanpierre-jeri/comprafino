"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

const ModalContext = createContext<{ dismiss: () => void; closing: boolean } | null>(null);
export function useModalDialog() {
  const context = useContext(ModalContext);
  if (!context) throw new Error("Modal controls require ModalDialog");
  return context;
}

/** Native focus containment with an exit animation before unmount/focus return. */
export function ModalDialog({
  labelledBy,
  className = "",
  onClose,
  children,
}: {
  labelledBy: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissing = useRef(false);
  const finished = useRef(false);
  const backdropPress = useRef(false);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>("[data-modal-initial-focus]")?.focus();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (timer.current !== null) clearTimeout(timer.current);
    dialog.current?.close();
    onClose();
  }, [onClose]);
  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    setClosing(true);
    // Recover if a browser suppresses animationend or styles are unavailable.
    timer.current = setTimeout(finish, 200);
  }, [finish]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;
    const outside = (x: number, y: number) => {
      const bounds = element.getBoundingClientRect();
      return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
    };
    const pointerDown = (event: PointerEvent) => {
      backdropPress.current = event.target === element && outside(event.clientX, event.clientY);
    };
    const pointerCancel = () => {
      backdropPress.current = false;
    };
    const click = (event: MouseEvent) => {
      if (
        backdropPress.current &&
        event.target === element &&
        outside(event.clientX, event.clientY)
      )
        dismiss();
      backdropPress.current = false;
    };
    element.addEventListener("pointerdown", pointerDown);
    element.addEventListener("pointercancel", pointerCancel);
    element.addEventListener("click", click);
    return () => {
      element.removeEventListener("pointerdown", pointerDown);
      element.removeEventListener("pointercancel", pointerCancel);
      element.removeEventListener("click", click);
    };
  }, [dismiss]);
  return (
    <dialog
      ref={dialog}
      className={`modal-dialog ${className}`}
      aria-labelledby={labelledBy}
      data-closing={closing || undefined}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "modal-out") finish();
      }}
    >
      <button
        type="button"
        className="modal-close"
        aria-label="Cerrar diálogo"
        disabled={closing}
        onClick={dismiss}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <ModalContext.Provider value={{ dismiss, closing }}>{children}</ModalContext.Provider>
    </dialog>
  );
}
