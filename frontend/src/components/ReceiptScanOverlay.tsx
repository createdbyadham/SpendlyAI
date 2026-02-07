import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import type { TextRegion } from "@/api/ocr";

const SCAN_SPEED = 2.5; // seconds to complete the full scan

interface ReceiptScanOverlayProps {
  imageUrl: string;
  textRegions: TextRegion[];
  imageWidth: number;
  imageHeight: number;
  onComplete: () => void;
}

export function ReceiptScanOverlay({
  imageUrl,
  textRegions,
  imageWidth,
  imageHeight,
  onComplete,
}: ReceiptScanOverlayProps) {
  const [phase, setPhase] = useState<"enter" | "scanning" | "exit">("enter");
  const [scanProgress, setScanProgress] = useState(0); // 0 to 100 representing scan line Y position (%)
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Phase 1 → 2: Once the image has faded in, start scanning
  useEffect(() => {
    if (phase === "enter" && imgLoaded) {
      const timer = setTimeout(() => setPhase("scanning"), 600);
      return () => clearTimeout(timer);
    }
  }, [phase, imgLoaded]);

  // Phase 2: Animate scan progress from 0 to 100
  // This single value controls BOTH the scan line position AND box visibility
  useEffect(() => {
    if (phase !== "scanning") return;
    if (textRegions.length === 0) {
      const timer = setTimeout(() => setPhase("exit"), 400);
      return () => clearTimeout(timer);
    }

    const startTime = Date.now();
    const durationMs = SCAN_SPEED * 1000;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, (elapsed / durationMs) * 100);
      setScanProgress(progress);

      if (progress < 100) {
        requestAnimationFrame(animate);
      } else {
        // Scan complete — hold briefly, then exit
        setTimeout(() => setPhase("exit"), 800);
      }
    };

    const frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [phase, textRegions.length]);

  // Phase 3: After exit animation, call onComplete
  useEffect(() => {
    if (phase === "exit") {
      const timer = setTimeout(onComplete, 600);
      return () => clearTimeout(timer);
    }
  }, [phase, onComplete]);

  // Calculate visible boxes count based on scanProgress
  const visibleBoxes = textRegions.filter((region) => {
    const boxTop = (region.box[1] / imageHeight) * 100;
    return scanProgress >= boxTop;
  });

  return (
    <AnimatePresence>
      {phase !== "exit" ? (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Image container - scan line is now INSIDE this container */}
          <motion.div
            ref={containerRef}
            className="relative max-w-[85vw] max-h-[80vh] overflow-hidden"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            {/* Receipt image */}
            <img
              src={imageUrl}
              alt="Receipt"
              className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain"
              onLoad={() => setImgLoaded(true)}
              draggable={false}
            />

            {/* Scan line - positioned relative to image, same coordinate space as boxes */}
            {phase === "scanning" && scanProgress < 100 && (
              <div
                className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent z-[10] pointer-events-none"
                style={{ top: `${scanProgress}%` }}
              />
            )}

            {/* Bounding box overlays - appear when scan line (scanProgress) passes their Y position */}
            {imgLoaded &&
              textRegions.map((region, i) => {
                const [xMin, yMin, xMax, yMax] = region.box;
                if (!xMin && !yMin && !xMax && !yMax) return null;

                const left = (xMin / imageWidth) * 100;
                const top = (yMin / imageHeight) * 100;
                const width = ((xMax - xMin) / imageWidth) * 100;
                const height = ((yMax - yMin) / imageHeight) * 100;

                // Box appears exactly when scanProgress >= box's top Y position
                if (scanProgress < top) return null;

                return (
                  <motion.div
                    key={i}
                    className="absolute border border-blue-400/70 bg-blue-400/10 rounded-sm pointer-events-none"
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${width}%`,
                      height: `${height}%`,
                    }}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                  />
                );
              })}

            {/* Status text */}
            <motion.div
              className="absolute -bottom-10 left-0 right-0 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <span className="text-sm text-zinc-400 font-medium">
                {phase === "enter" && "Loading receipt..."}
                {phase === "scanning" && scanProgress < 100 &&
                  `Scanning text... ${visibleBoxes.length}/${textRegions.length}`}
                {phase === "scanning" && scanProgress >= 100 &&
                  `Found ${textRegions.length} text regions`}
              </span>
            </motion.div>
          </motion.div>
        </motion.div>
      ) : (
        // Exit phase — fade everything out
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        />
      )}
    </AnimatePresence>
  );
}
