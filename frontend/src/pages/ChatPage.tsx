"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PlaceholdersAndVanishInput } from "../components/ui/placeholders-and-vanish-input";
import { useState, useEffect, useRef, useCallback } from "react";
import { useChatMutation } from "../api/chat";
import { cn } from "@/lib/utils";
import { MeshGradient } from "../components/MeshGradient";
import { ReceiptScanOverlay } from "../components/ReceiptScanOverlay";
import { parseReceipt, type ScanResponse, type ParseResponse } from "@/api/ocr";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface Message {
  content: string;
  role: 'user' | 'assistant';
}

interface ScanState {
  imageUrl: string;
  scanResult: ScanResponse;
}

// Spendly Logo Icon Component
const SpendlyIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </svg>
);

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const chatMutation = useChatMutation();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Ref to hold the LLM parse promise that runs in parallel with the animation
  const parsePromiseRef = useRef<Promise<ParseResponse> | null>(null);
  const animationDoneRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const placeholders = [
    "How much did I spend on groceries last month?",
    "Show me all my coffee purchases",
    "Which store do I spend the most at?",
    "What was my most expensive purchase?",
    "Breakdown my spending by category",
  ];

  const handleChange = () => {
    // Handle input change if needed
  };

  // Called after the fast OCR scan completes — shows overlay AND fires LLM parse in parallel
  const handleReceiptScanned = useCallback((imageUrl: string, scanResult: ScanResponse) => {
    // 1. Show the scanning animation overlay
    setScanState({ imageUrl, scanResult });
    animationDoneRef.current = false;

    // 2. Fire LLM parse in the background (runs while animation plays)
    parsePromiseRef.current = parseReceipt(scanResult.raw_text);
  }, []);

  // Called when the scan overlay animation finishes
  const handleScanComplete = useCallback(async () => {
    if (!scanState) return;
    const { imageUrl } = scanState;

    // Clean up
    URL.revokeObjectURL(imageUrl);
    setScanState(null);
    animationDoneRef.current = true;

    // Add user message and expand chat
    setMessages(prev => [...prev, { content: "Uploaded a receipt for processing", role: 'user' as const }]);
    if (!isExpanded) setIsExpanded(true);

    // Wait for the LLM parse that was already running in parallel
    try {
      await parsePromiseRef.current;
      parsePromiseRef.current = null;

    } catch (error) {
      console.error('Failed to process receipt:', error);
    }
  }, [scanState, isExpanded]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const message = formData.get("message") as string;
    const ocrData = formData.get("ocr_data") as string;

    if (!message?.trim() && !ocrData) return;

    // Add user message
    const userMessage = { content: message || "Uploaded a receipt for processing", role: 'user' as const };
    setMessages(prev => [...prev, userMessage]);

    if (!isExpanded) {
      setIsExpanded(true);
    }

    try {
      setIsTyping(true);
      const response = await chatMutation.mutateAsync(ocrData || message);
      setMessages(prev => [...prev, { content: response.response, role: 'assistant' }]);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      <MeshGradient />
      <div className="fixed inset-0 flex flex-col w-full overflow-hidden z-10">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <SpendlyIcon className="w-5 h-5 text-[#0d1117]" />
            </div>
            <span className="text-white font-medium text-lg">Spendly</span>
          </div>
        </header>

        {/* Main Content */}
        <div className={cn(
          "flex flex-col flex-1 h-full px-4",
          !isExpanded && "justify-center items-center"
        )}>
          {/* Welcome Section - Only shown when not expanded */}
          {!isExpanded && (
            <motion.div
              className="flex flex-col items-center text-center mb-8"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              {/* Logo Icon */}
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-8 shadow-lg">
                <SpendlyIcon className="w-10 h-10 text-[#1a2332]" />
              </div>

              {/* Greeting */}
              <h2 className="text-[#6b9fff] text-2xl font-medium mb-2">
                Hi, there
              </h2>
              <h1 className="text-white text-3xl sm:text-3xl font-semibold mb-4">
                Can I help you with anything?
              </h1>

              {/* Subtitle */}
              <p className="text-gray-400 text-xs max-w-md leading-relaxed">
                Ready to assist you with anything you need?
                <br />
                From answering questions, generation to providing
                <br />
                recommendations. Let's get started!
              </p>
            </motion.div>
          )}

          {/* Chat Messages - Only shown when expanded */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                className="flex-1 overflow-y-auto min-h-0 mb-4 space-y-4 w-full scroll-smooth"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
              >
                {messages.map((message, index) => (
                  <motion.div
                    key={index}
                    className={cn(
                      "flex",
                      message.role === 'user' ? "justify-end" : "justify-start"
                    )}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className={cn(
                      "px-4 py-2 rounded-3xl max-w-[85%] sm:max-w-[75%]",
                      message.role === 'user'
                        ? "bg-blue-500 text-white"
                        : "bg-zinc-800/70 backdrop-blur-sm text-gray-100"
                    )}>
                      {message.role === 'assistant' ? (
                        <div className="prose prose-invert max-w-none text-left">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]}
                            components={{
                              p: ({ ...props }) => <p className="m-0" {...props} />,
                              ul: ({ ...props }) => <ul className="m-0 pl-4" {...props} />,
                              ol: ({ ...props }) => <ol className="m-0 pl-4" {...props} />,
                              li: ({ ...props }) => <li className="my-1" {...props} />,
                              strong: ({ ...props }) => <strong className="font-bold text-blue-300" {...props} />,
                              h1: ({ ...props }) => <h1 className="text-xl font-bold my-2" {...props} />,
                              h2: ({ ...props }) => <h2 className="text-lg font-bold my-2" {...props} />,
                              h3: ({ ...props }) => <h3 className="text-base font-bold my-1" {...props} />,
                              code: ({ ...props }) => <code className="bg-black/30 rounded px-1" {...props} />,
                              table: ({ ...props }) => <table className="border-collapse my-2" {...props} />,
                              th: ({ ...props }) => <th className="border border-gray-600 px-2 py-1" {...props} />,
                              td: ({ ...props }) => <td className="border border-gray-600 px-2 py-1" {...props} />
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        message.content
                      )}
                    </div>
                  </motion.div>
                ))}
                {isTyping && (
                  <motion.div
                    className="flex justify-start"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                  >
                    <div className="px-4 py-2 rounded-3xl bg-zinc-800/70 backdrop-blur-sm">
                      <div className="flex items-center space-x-1">
                        <motion.div
                          className="w-1.5 h-1.5 bg-gray-300 rounded-full"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                        />
                        <motion.div
                          className="w-1.5 h-1.5 bg-gray-300 rounded-full"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                        />
                        <motion.div
                          className="w-1.5 h-1.5 bg-gray-300 rounded-full"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input Section */}
          <div className={cn(
            "w-full max-w-2xl mx-auto flex flex-col items-center gap-4",
            !isExpanded && "w-full"
          )}>

            {/* Input Field */}
            <PlaceholdersAndVanishInput
              placeholders={placeholders}
              onChange={handleChange}
              onSubmit={onSubmit}
              onReceiptScanned={handleReceiptScanned}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 text-center flex-shrink-0">
          <p className="text-gray-500 text-xs">
            Your data remains local and isn't uploaded to any server.
          </p>
        </footer>

        {/* Receipt scanning overlay */}
        {scanState && (
          <ReceiptScanOverlay
            imageUrl={scanState.imageUrl}
            textRegions={scanState.scanResult.ocr_regions.text_regions}
            imageWidth={scanState.scanResult.ocr_regions.image_width}
            imageHeight={scanState.scanResult.ocr_regions.image_height}
            onComplete={handleScanComplete}
          />
        )}
      </div>
    </>
  );
}
