"use client"

import React, { useRef, useEffect } from "react"

// Mesh Gradient Background Component - Dark Navy Theme
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
      time += 0.003

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Create multiple gradient layers for mesh effect
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      // Base dark gradient
      const baseGradient = ctx.createRadialGradient(
        centerX,
        centerY * 0.6,
        0,
        centerX,
        centerY,
        Math.max(canvas.width, canvas.height)
      )
      baseGradient.addColorStop(0, "#1a2332")
      baseGradient.addColorStop(0.5, "#141c28")
      baseGradient.addColorStop(1, "#0d1117")

      ctx.globalCompositeOperation = "source-over"
      ctx.fillStyle = baseGradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Subtle animated glow
      const glowGradient = ctx.createRadialGradient(
        centerX + Math.sin(time) * 100,
        centerY * 0.5 + Math.cos(time) * 50,
        0,
        centerX + Math.sin(time) * 100,
        centerY * 0.5 + Math.cos(time) * 50,
        Math.max(canvas.width, canvas.height) * 0.6
      )
      glowGradient.addColorStop(0, `rgba(30, 58, 95, ${0.15 + Math.sin(time) * 0.05})`)
      glowGradient.addColorStop(0.5, `rgba(20, 40, 70, ${0.1 + Math.cos(time) * 0.03})`)
      glowGradient.addColorStop(1, "rgba(13, 17, 23, 0)")

      ctx.globalCompositeOperation = "screen"
      ctx.fillStyle = glowGradient
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
        background: "#0d1117",
      }}
    />
  )
}