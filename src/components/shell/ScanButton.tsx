"use client";

import { useRef, useState } from "react";
import { ScanLine } from "lucide-react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/**
 * Camera barcode/QR scanning via the browser BarcodeDetector API where supported.
 * Handheld USB/Bluetooth scanners work without this: they type into the focused search field.
 */
export function ScanButton({ targetId }: { targetId: string }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  async function start() {
    setMsg(null);
    const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setOpen(true);
      setMsg("Camera scanning isn't supported in this browser. Click into the search box and scan with a handheld scanner, or type the code.");
      return;
    }
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      const detector = new Ctor({ formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix"] });
      const tick = async () => {
        if (!streamRef.current) return;
        const codes = await detector.detect(v).catch(() => []);
        if (codes[0]?.rawValue) {
          stop();
          const value = codes[0].rawValue;
          // Traveller QR codes encode in-app paths; only same-origin paths are followed.
          const sameOriginPath = value.startsWith(`${location.origin}/`) ? value.slice(location.origin.length) : value;
          if (sameOriginPath.startsWith("/") && !sameOriginPath.startsWith("//") && !sameOriginPath.startsWith("/\\")) {
            location.assign(sameOriginPath);
            return;
          }
          const input = document.getElementById(targetId) as HTMLInputElement | null;
          if (input) {
            input.value = value;
            input.form?.requestSubmit();
          }
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setMsg("Camera access was blocked. Allow camera access for this site, or use a handheld scanner.");
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={start} className="rounded-sm border border-line bg-sheet p-2 text-ink-2 hover:bg-line-2" aria-label="Scan a barcode or QR code" title="Scan barcode / QR">
        <ScanLine size={16} />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Scan code" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
          <div className="w-full max-w-md rounded-md bg-sheet p-4">
            <p className="font-semibold">Scan a job, operation, lot or drawing code</p>
            {msg ? <p className="mt-2 text-[13.5px] text-steel">{msg}</p> : <video ref={videoRef} className="mt-3 aspect-video w-full rounded-sm bg-ink" muted playsInline />}
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={stop} className="rounded-sm border border-line px-3 py-1.5 text-[13.5px]">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
