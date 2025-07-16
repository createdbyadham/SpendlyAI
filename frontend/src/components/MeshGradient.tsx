"use client"

import React, { useRef, useEffect } from "react"

// Mesh Gradient Background Component
export const MeshGradient: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationId: number
    let time = 0

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const animate = () => {
      time += 0.005

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Create multiple gradient layers for mesh effect
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      // First gradient (blue to cyan)
      const gradient1 = ctx.createRadialGradient(
        centerX + Math.sin(time) * 200,
        centerY + Math.cos(time) * 150,
        0,
        centerX + Math.sin(time) * 200,
        centerY + Math.cos(time) * 150,
        Math.max(canvas.width, canvas.height) * 0.8,
      )
      gradient1.addColorStop(0, `rgba(11, 11, 11, ${0.4 + Math.sin(time) * 0.1})`)
      gradient1.addColorStop(1, `rgba(11, 11, 11, ${0.2 + Math.cos(time + 1) * 0.1})`)

      // Apply gradients with blend modes
      ctx.globalCompositeOperation = "screen"

      ctx.fillStyle = gradient1
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      animationId = requestAnimationFrame(animate)
    }

    resize()
    animate()
    window.addEventListener("resize", resize)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener("resize", resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        background: "#21252b",
      }}
    />
  )
} 