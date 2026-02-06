import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import type { TextRegion } from "@/api/ocr";

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
  const [visibleBoxes, setVisibleBoxes] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Phase 1 → 2: Once the image has faded in, start scanning
  useEffect(() => {
    if (phase === "enter" && imgLoaded) {
      const timer = setTimeout(() => setPhase("scanning"), 600);
      return () => clearTimeout(timer);
    }
  }, [phase, imgLoaded]);

  // Phase 2: Reveal boxes one by one with a stagger
  useEffect(() => {
    if (phase !== "scanning") return;
    if (textRegions.length === 0) {
      // No regions detected, skip to exit
      const timer = setTimeout(() => setPhase("exit"), 400);
      return () => clearTimeout(timer);
    }

    if (visibleBoxes < textRegions.length) {
      const delay = Math.max(30, 600 / textRegions.length); // faster stagger for many boxes
      const timer = setTimeout(() => setVisibleBoxes((v) => v + 1), delay);
      return () => clearTimeout(timer);
    } else {
      // All boxes revealed — hold briefly, then exit
      const timer = setTimeout(() => setPhase("exit"), 800);
      return () => clearTimeout(timer);
    }
  }, [phase, visibleBoxes, textRegions.length]);

  // Phase 3: After exit animation, call onComplete
  useEffect(() => {
    if (phase === "exit") {
      const timer = setTimeout(onComplete, 600);
      return () => clearTimeout(timer);
    }
  }, [phase, onComplete]);

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
          {/* Scan line animation */}
          {phase === "scanning" && visibleBoxes < textRegions.length && (
            <motion.div
              className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent z-[103] pointer-events-none"
              style={{ top: 0 }}
              initial={{ top: "0%" }}
              animate={{ top: "100%" }}
              transition={{
                duration: Math.max(0.8, textRegions.length * 0.04),
                ease: "linear",
              }}
            />
          )}

          {/* Image container */}
          <motion.div
            ref={containerRef}
            className="relative max-w-[85vw] max-h-[80vh]"
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

            {/* Bounding box overlays */}
            {imgLoaded &&
              textRegions.slice(0, visibleBoxes).map((region, i) => {
                // Convert absolute pixel coords to percentage of image
                const [xMin, yMin, xMax, yMax] = region.box;
                if (!xMin && !yMin && !xMax && !yMax) return null;

                const left = (xMin / imageWidth) * 100;
                const top = (yMin / imageHeight) * 100;
                const width = ((xMax - xMin) / imageWidth) * 100;
                const height = ((yMax - yMin) / imageHeight) * 100;

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
                {phase === "scanning" &&
                  visibleBoxes < textRegions.length &&
                  `Scanning text... ${visibleBoxes}/${textRegions.length}`}
                {phase === "scanning" &&
                  visibleBoxes >= textRegions.length &&
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
