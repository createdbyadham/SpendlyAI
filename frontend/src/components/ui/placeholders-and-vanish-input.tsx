"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useScanMutation, type ScanResponse } from "@/api/ocr";
import { Spinner } from "./spinner";

export function PlaceholdersAndVanishInput({
  placeholders,
  onChange,
  onSubmit,
  onReceiptScanned,
}: {
  placeholders: string[];
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onReceiptScanned?: (imageUrl: string, scanResult: ScanResponse) => void;
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startAnimation = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
    }, 3000);
  }, [placeholders]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState !== "visible" && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    } else if (document.visibilityState === "visible") {
      startAnimation();
    }
  }, [startAnimation]);

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

  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanMutation = useScanMutation();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Let the form handle submit
    }
    if (e.key === "Escape") {
      setValue("");
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (onSubmit) onSubmit(e);
    setValue("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const imageUrl = URL.createObjectURL(file);

    try {
      const scanResult = await scanMutation.mutateAsync(file);

      if (onReceiptScanned) {
        onReceiptScanned(imageUrl, scanResult);
      } else {
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      URL.revokeObjectURL(imageUrl);
      console.error('Failed to scan receipt:', error);
    }

    e.target.value = '';
  };

  return (
    <form
      className={cn(
        "w-full relative max-w-xl mx-auto bg-[#262e3a] h-12 rounded-full overflow-hidden shadow-lg border border-white/10 transition duration-200"
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
        className="absolute left-2 top-1/2 z-[60] -translate-y-1/2 h-8 w-8 text-zinc-400 hover:text-zinc-100 transition duration-200 flex items-center justify-center cursor-pointer"
        disabled={scanMutation.isPending}
      >
        {scanMutation.isPending ? (
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
            className="h-4 w-4"
          >
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
            <line x1="16" y1="5" x2="22" y2="5" />
            <line x1="19" y1="2" x2="19" y2="8" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </motion.svg>
        )}
      </button>

      <input
        name="message"
        onChange={(e) => {
          setValue(e.target.value);
          if (onChange) onChange(e);
        }}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        value={value}
        type="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        data-form-type="other"
        className="w-full relative text-sm sm:text-base z-50 border-none text-zinc-200 bg-transparent h-full rounded-full focus:outline-none focus:ring-0 pl-12 pr-20 placeholder:text-zinc-500"
      />

      <button
        disabled={!value}
        type="submit"
        className={cn(
          "absolute right-2 top-1/2 z-50 -translate-y-1/2 h-8 w-8 rounded-full transition duration-200 flex items-center justify-center",
          value ? "bg-white text-black" : "bg-zinc-700/50 text-zinc-400"
        )}
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
          className="h-4 w-4"
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
              className="text-zinc-500 text-sm sm:text-base font-normal pl-12 text-left w-[calc(100%-2rem)] truncate pointer-events-none"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
