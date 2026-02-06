"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PlaceholdersAndVanishInput } from "../components/ui/placeholders-and-vanish-input";
import { useState, useEffect, useRef, useCallback } from "react";
import { useChatMutation } from "../api/chat";
import { cn } from "@/lib/utils";
import { TextEffect } from "../components/TextEffect";
import { MeshGradient } from "../components/MeshGradient";
import { ReceiptScanOverlay } from "../components/ReceiptScanOverlay";
import type { OCRResponse } from "@/api/ocr";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface Message {
  content: string;
  role: 'user' | 'assistant';
}

interface ScanState {
  imageUrl: string;
  ocrResult: OCRResponse;
}

export function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const chatMutation = useChatMutation();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Called by PlaceholdersAndVanishInput after OCR completes — shows the scanning overlay
  const handleReceiptScanned = useCallback((imageUrl: string, ocrResult: OCRResponse) => {
    setScanState({ imageUrl, ocrResult });
  }, []);

  // Called when the scan overlay animation finishes — submits OCR data to chat
  const handleScanComplete = useCallback(async () => {
    if (!scanState) return;
    const { imageUrl, ocrResult } = scanState;

    // Clean up the object URL
    URL.revokeObjectURL(imageUrl);
    setScanState(null);

    // Now submit the OCR data to the chat flow
    const userMessage = { content: "Uploaded a receipt for processing", role: 'user' as const };
    setMessages(prev => [...prev, userMessage]);

    if (!isExpanded) {
      setIsExpanded(true);
    }

    try {
      setIsTyping(true);
      const response = await chatMutation.mutateAsync(JSON.stringify(ocrResult));
      setMessages(prev => [...prev, { content: response.response, role: 'assistant' }]);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsTyping(false);
    }
  }, [scanState, isExpanded, chatMutation]);

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
      <div className="fixed inset-0 flex flex-col w-full max-w-4xl mx-auto px-4 overflow-hidden z-10 mt-6 mb-6">
          <div className={cn(
            "flex flex-col flex-1 h-full",
            !isExpanded && "justify-center items-center"
          )}>
            <TextEffect
              as="h2"
              per="word"
              className={cn(
                "text-center text-white font-semibold flex-shrink-0",
                isExpanded 
                  ? "hidden" 
                  : "text-3xl sm:text-5xl mb-10"
              )}
            >
              Ask SpendlyAI Anything
            </TextEffect>

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
                                p: ({...props}) => <p className="m-0" {...props} />,
                                ul: ({...props}) => <ul className="m-0 pl-4" {...props} />,
                                ol: ({...props}) => <ol className="m-0 pl-4" {...props} />,
                                li: ({...props}) => <li className="my-1" {...props} />,
                                strong: ({...props}) => <strong className="font-bold text-blue-300" {...props} />,
                                h1: ({...props}) => <h1 className="text-xl font-bold my-2" {...props} />,
                                h2: ({...props}) => <h2 className="text-lg font-bold my-2" {...props} />,
                                h3: ({...props}) => <h3 className="text-base font-bold my-1" {...props} />,
                                code: ({...props}) => <code className="bg-black/30 rounded px-1" {...props} />,
                                table: ({...props}) => <table className="border-collapse my-2" {...props} />,
                                th: ({...props}) => <th className="border border-gray-600 px-2 py-1" {...props} />,
                                td: ({...props}) => <td className="border border-gray-600 px-2 py-1" {...props} />
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
            <div className={cn(
              "w-full max-w-xl mx-auto",
              !isExpanded && "w-full"
            )}>
              <PlaceholdersAndVanishInput
                placeholders={placeholders}
                onChange={handleChange}
                onSubmit={onSubmit}
                onReceiptScanned={handleReceiptScanned}
              />
            </div>
          </div>

          {/* Receipt scanning overlay */}
          {scanState && (
            <ReceiptScanOverlay
              imageUrl={scanState.imageUrl}
              textRegions={scanState.ocrResult.ocr_regions.text_regions}
              imageWidth={scanState.ocrResult.ocr_regions.image_width}
              imageHeight={scanState.ocrResult.ocr_regions.image_height}
              onComplete={handleScanComplete}
            />
          )}
      </div>
    </>
  );
}
