import { useTranslation } from "@browser-skill/i18n/react";
import { RiStopCircleLine } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import logoUrl from "../../assets/logo.png";

export interface ControlOverlayProps {
  visible: boolean;
  interrupting: boolean;
  automationBypass: boolean;
  /** Client that owns this window's session (`Codex`, …); `null` = unknown. */
  agentName?: string | null;
  /** Session id shown when the client did not supply a name. */
  sessionId?: string | null;
  onInterrupt: () => void;
}

/** Longest session-id prefix shown in the hint chip. */
const SESSION_CHIP_LENGTH = 8;

/**
 * Control hints for an Agent-controlled window.
 *
 * Chromium exposes no API to tint a native window frame, so the hint is
 * painted inside the controlled tab: an orange viewport frame plus a fixed
 * top bar that names the controlling agent, and the interrupt pill kept from
 * the original design. All of it lives in the content script's shadow root,
 * above page content, and is removed the moment control ends.
 */
export function ControlOverlay({
  visible,
  interrupting,
  automationBypass,
  agentName = null,
  sessionId = null,
  onInterrupt,
}: ControlOverlayProps) {
  const { t } = useTranslation("extension");
  const [show, setShow] = useState(false);
  const blockerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) {
      const raf = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(raf);
    }
    setShow(false);
  }, [visible]);

  useEffect(() => {
    const blocker = blockerRef.current;
    if (!blocker) return;
    const stopScroll = (event: WheelEvent | TouchEvent) => {
      if (automationBypass) return;
      event.preventDefault();
      event.stopPropagation();
    };
    blocker.addEventListener("wheel", stopScroll, { passive: false });
    blocker.addEventListener("touchmove", stopScroll, { passive: false });
    return () => {
      blocker.removeEventListener("wheel", stopScroll);
      blocker.removeEventListener("touchmove", stopScroll);
    };
  }, [automationBypass]);

  useEffect(() => {
    if (!visible || automationBypass) return;
    const stopScroll = (event: WheelEvent | TouchEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("wheel", stopScroll, { capture: true, passive: false });
    window.addEventListener("touchmove", stopScroll, { capture: true, passive: false });
    return () => {
      window.removeEventListener("wheel", stopScroll, { capture: true });
      window.removeEventListener("touchmove", stopScroll, { capture: true });
    };
  }, [visible, automationBypass]);

  if (!visible) return null;

  const pointerEvents = automationBypass ? "none" : "auto";
  const displayName =
    agentName && agentName.trim() !== "" ? agentName : t("controlOverlay.unknownAgent");
  const statusText = t("controlOverlay.statusFor", { agent: displayName });
  const sessionChip = sessionId ? sessionId.slice(0, SESSION_CHIP_LENGTH) : null;
  const fade = {
    opacity: show ? 1 : 0,
    transition: "opacity 300ms ease-out",
  } as const;

  return (
    <>
      <style>{`
        @keyframes bsk-breathe {
          0%, 100% {
            box-shadow:
              inset 0 0 0 3px rgba(249,115,22,0.75),
              inset 0 0 20px 4px rgba(249,115,22,0.25);
          }
          50% {
            box-shadow:
              inset 0 0 0 3px rgba(249,115,22,1),
              inset 0 0 40px 8px rgba(249,115,22,0.45);
          }
        }
      `}</style>

      {/* Orange viewport frame: the "this window is controlled" cue that
          survives page layout and stands in for a native frame tint. */}
      <div
        data-slot="control-overlay"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483646,
          pointerEvents: "none",
          animation: "bsk-breathe 3s ease-in-out infinite",
          ...fade,
        }}
      />

      {/* Persistent top bar naming the controlling agent. Informational
          only, so it never intercepts page or CDP input. */}
      <div
        data-slot="control-overlay-bar"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 2147483647,
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 34,
          padding: "0 12px",
          background: "linear-gradient(180deg, #fb923c 0%, #f97316 60%, #ea580c 100%)",
          boxShadow: "0 2px 10px rgba(124,45,18,0.35)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          ...fade,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: "#fff",
            flexShrink: 0,
          }}
        >
          <img src={logoUrl} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />
        </span>
        <span
          data-slot="control-overlay-agent"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            userSelect: "none",
            textShadow: "0 1px 1px rgba(124,45,18,0.35)",
          }}
        >
          {statusText}
        </span>
        {sessionChip ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "#fff",
              backgroundColor: "rgba(255,255,255,0.22)",
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 9999,
              padding: "1px 7px",
              letterSpacing: 0.4,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}
          >
            {sessionChip}
          </span>
        ) : null}
      </div>

      <div
        ref={blockerRef}
        data-slot="control-overlay-blocker"
        onPointerDown={(event) => {
          if (automationBypass) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          if (automationBypass) return;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2147483646,
          pointerEvents,
          background: "transparent",
          ...fade,
        }}
      />

      <div
        data-slot="control-overlay-pill"
        style={{
          position: "fixed",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2147483647,
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: 12,
          backgroundColor: "#fff",
          borderRadius: 9999,
          padding: "10px 10px 10px 20px",
          boxShadow: "0 8px 32px rgba(124,45,18,0.16), 0 2px 8px rgba(0,0,0,0.1)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          ...fade,
        }}
      >
        <img
          src={logoUrl}
          alt="browser-skill"
          style={{ width: 24, height: 24, borderRadius: 4, flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: "#333",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          {statusText}
        </span>
        <button
          type="button"
          data-slot="control-overlay-stop-all"
          disabled={interrupting}
          onClick={onInterrupt}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            borderRadius: 9999,
            padding: "8px 20px 8px 16px",
            fontSize: 15,
            fontWeight: 600,
            color: "#fff",
            backgroundColor: interrupting ? "#9ca3af" : "#f97316",
            cursor: interrupting ? "default" : "pointer",
            opacity: interrupting ? 0.7 : 1,
            transition: "background-color 150ms ease-out, opacity 150ms ease-out",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          <RiStopCircleLine size={18} color="#fff" />
          {interrupting ? t("controlOverlay.interrupting") : t("controlOverlay.interrupt")}
        </button>
      </div>
    </>
  );
}
