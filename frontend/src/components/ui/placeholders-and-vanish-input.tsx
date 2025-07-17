"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useOCRMutation } from "@/api/ocr";
import { Spinner } from "./spinner";

interface PixelData {
  x: number;
  y: number;
  r: number;
  color: string;
}

export function PlaceholdersAndVanishInput({
  placeholders,
  onChange,
  onSubmit,
}: {
  placeholders: string[];
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startAnimation = () => {
    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
    }, 3000);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" && intervalRef.current) {
      clearInterval(intervalRef.current); // Clear the interval when the tab is not visible
      intervalRef.current = null;
    } else if (document.visibilityState === "visible") {
      startAnimation(); // Restart the interval when the tab becomes visible
    }
  };

  useEffect(() => {
    startAnimation();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [placeholders]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const newDataRef = useRef<PixelData[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [animating, setAnimating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrMutation = useOCRMutation();

  const draw = useCallback(() => {
    if (!inputRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 800;
    ctx.clearRect(0, 0, 800, 800);
    const computedStyles = getComputedStyle(inputRef.current);

    const fontSize = parseFloat(computedStyles.getPropertyValue("font-size"));
    ctx.font = `${fontSize * 2}px ${computedStyles.fontFamily}`;
    ctx.fillStyle = "#FFF";
    ctx.fillText(value, 16, 40);

    const imageData = ctx.getImageData(0, 0, 800, 800);
    const pixelData = imageData.data;
    const newData: PixelData[] = [];

    for (let t = 0; t < 800; t++) {
      const i = 4 * t * 800;
      for (let n = 0; n < 800; n++) {
        const e = i + 4 * n;
        if (
          pixelData[e] !== 0 &&
          pixelData[e + 1] !== 0 &&
          pixelData[e + 2] !== 0
        ) {
          newData.push({
            x: n,
            y: t,
            r: 1,
            color: `rgba(${pixelData[e]}, ${pixelData[e + 1]}, ${pixelData[e + 2]}, ${pixelData[e + 3]})`,
          });
        }
      }
    }

    newDataRef.current = newData.map(({ x, y, color }) => ({
      x,
      y,
      r: 1,
      color: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`,
    }));
  }, [value]);

  useEffect(() => {
    draw();
  }, [value, draw]);

  const animate = (start: number) => {
    let animationFrameId: number;
    const safetyTimeout = setTimeout(() => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      setAnimating(false);
      setValue("");
      newDataRef.current = [];
    }, 3000);

    const animateFrame = (pos: number = 0) => {
      animationFrameId = requestAnimationFrame(() => {
        try {
          const newArr = [];
          for (let i = 0; i < newDataRef.current.length; i++) {
            const current = newDataRef.current[i];
            if (current.x < pos) {
              newArr.push(current);
            } else {
              if (current.r <= 0) {
                current.r = 0;
                continue;
              }
              current.x += Math.random() > 0.5 ? 1 : -1;
              current.r -= 0.05 * Math.random();
              newArr.push(current);
            }
          }
          newDataRef.current = newArr;
          const ctx = canvasRef.current?.getContext("2d");
          if (ctx) {
            ctx.clearRect(pos, 0, 800, 800);
            newDataRef.current.forEach((t) => {
              const { x: n, y: i, r: s, color: color } = t;
              if (n > pos) {
                ctx.beginPath();
                ctx.rect(n, i, s, s);
                ctx.fillStyle = color;
                ctx.strokeStyle = color;
                ctx.stroke();
              }
            });
          }
          if (newDataRef.current.length > 0) {
            animateFrame(pos - 8);
          } else {
            setValue("");
            setAnimating(false);
            clearTimeout(safetyTimeout);
            if (animationFrameId) {
              cancelAnimationFrame(animationFrameId);
            }
          }
        } catch (error) {
          console.error('Animation error:', error);
          setValue("");
          setAnimating(false);
          newDataRef.current = [];
          clearTimeout(safetyTimeout);
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
          }
        }
      });
    };
    animateFrame(start);

    // Cleanup function
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      clearTimeout(safetyTimeout);
    };
  };

  // Add cleanup for animation state when component unmounts or updates
  useEffect(() => {
    return () => {
      setAnimating(false);
      setValue("");
      newDataRef.current = [];
    };
  }, []);

  // Add blur handler to reset states
  const handleBlur = () => {
    if (animating) {
      setAnimating(false);
      setValue("");
      newDataRef.current = [];
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !animating) {
      vanishAndSubmit();
    }
    // Add Escape key to reset animation state
    if (e.key === "Escape") {
      setAnimating(false);
      setValue("");
      newDataRef.current = [];
    }
  };

  const vanishAndSubmit = () => {
    setAnimating(true);
    draw();

    const value = inputRef.current?.value || "";
    if (value && inputRef.current) {
      const maxX = newDataRef.current.reduce(
        (prev, current) => (current.x > prev ? current.x : prev),
        0
      );
      animate(maxX);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    vanishAndSubmit();
    if (onSubmit) onSubmit(e);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await ocrMutation.mutateAsync(file);
      
      // Add a hidden input to the form with the OCR data
      const hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = 'ocr_data';
      hiddenInput.value = JSON.stringify(result);
      e.target.form?.appendChild(hiddenInput);
      
      // Submit the form
      e.target.form?.requestSubmit();
      
      // Clean up the hidden input
      setTimeout(() => hiddenInput.remove(), 100);
    } catch (error) {
      console.error('Failed to process receipt:', error);
    }
  };

  return (
    <form
      className={cn(
        "w-full relative max-w-xl mx-auto bg-zinc-800/70 backdrop-blur-sm h-12 rounded-full overflow-hidden shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),_0px_1px_0px_0px_rgba(25,28,33,0.02),_0px_0px_0px_1px_rgba(25,28,33,0.08)] transition duration-200",
        value && "bg-zinc-800/80"
      )}
      onSubmit={handleSubmit}
    >
      <input 
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        className="hidden"
      />
      
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="absolute left-2 top-1/2 z-[60] -translate-y-1/2 h-8 w-8 rounded-full bg-zinc-700/50 hover:bg-zinc-600/50 transition duration-200 flex items-center justify-center cursor-pointer"
        disabled={ocrMutation.isPending}
      >
        {ocrMutation.isPending ? (
          <Spinner size="sm" className="text-gray-300" />
        ) : (
          <motion.svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-300 h-4 w-4"
          >
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
            <line x1="16" y1="5" x2="22" y2="5" />
            <line x1="19" y1="2" x2="19" y2="8" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </motion.svg>
        )}
      </button>

      <canvas
        className={cn(
          "absolute pointer-events-none text-base transform scale-50 top-[20%] left-12 sm:left-16 origin-top-left filter invert pr-20",
          !animating ? "opacity-0" : "opacity-100"
        )}
        ref={canvasRef}
      />
      <input
        name="message"
        onChange={(e) => {
          if (!animating) {
            setValue(e.target.value);
            if (onChange) onChange(e);
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        ref={inputRef}
        value={value}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        data-form-type="other"
        className={cn(
          "w-full relative text-sm sm:text-base z-50 border-none text-white bg-transparent h-full rounded-full focus:outline-none focus:ring-0 pl-12 sm:pl-16 pr-20",
          animating && "text-transparent"
        )}
      />

      <button
        disabled={!value}
        type="submit"
        className="absolute right-2 top-1/2 z-50 -translate-y-1/2 h-8 w-8 rounded-full disabled:bg-zinc-700/50 bg-blue-500 transition duration-200 flex items-center justify-center"
      >
        <motion.svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-300 h-4 w-4"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <motion.path
            d="M5 12l14 0"
            initial={{
              strokeDasharray: "50%",
              strokeDashoffset: "50%",
            }}
            animate={{
              strokeDashoffset: value ? 0 : "50%",
            }}
            transition={{
              duration: 0.3,
              ease: "linear",
            }}
          />
          <path d="M13 18l6 -6" />
          <path d="M13 6l6 6" />
        </motion.svg>
      </button>

      <div className="absolute inset-0 flex items-center rounded-full pointer-events-none z-40">
        <AnimatePresence mode="wait">
          {!value && (
            <motion.p
              initial={{
                y: 5,
                opacity: 0,
              }}
              key={`current-placeholder-${currentPlaceholder}`}
              animate={{
                y: 0,
                opacity: 1,
              }}
              exit={{
                y: -15,
                opacity: 0,
              }}
              transition={{
                duration: 0.3,
                ease: "linear",
              }}
              className="dark:text-zinc-500 text-sm sm:text-base font-normal text-neutral-500 pl-12 sm:pl-16 text-left w-[calc(100%-2rem)] truncate pointer-events-none"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
