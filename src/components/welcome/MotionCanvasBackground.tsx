/**
 * Premium Motion Canvas Background
 * A cinematic, high-performance HTML5 Canvas visual representing clarity, organization,
 * and personal productivity through layered geometric movement and gentle harmonic nodes.
 * 
 * Performance & Accessibility features:
 * - High-DPI crisp rendering (devicePixelRatio)
 * - Automatic pause when tab is inactive (document.visibilityState)
 * - Respects prefers-reduced-motion with an elegant, static architectural blueprint fallback
 * - 60 FPS requestAnimationFrame with time-delta dampening
 */
import React, { useEffect, useRef } from 'react';

interface MotionCanvasBackgroundProps {
  className?: string;
}

interface ParticleNode {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  vx: number;
  vy: number;
  radius: number;
  phase: number;
  speed: number;
  ringRadius: number;
  layer: number; // 0: background subtle, 1: mid clarity, 2: foreground anchor
}

const EDGE_ALPHA_STEPS = 16;
const EDGE_STROKE_STYLES = Array.from({ length: EDGE_ALPHA_STEPS + 1 }, (_, i) => {
  const alpha = ((i / EDGE_ALPHA_STEPS) * 0.085).toFixed(4);
  return `rgba(17, 17, 17, ${alpha})`;
});

export const MotionCanvasBackground: React.FC<MotionCanvasBackgroundProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Check user preference for reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    let currentDpr = 1;
    let isTabVisible = !document.hidden;
    let isIntersecting = true;

    // Offscreen cached radial backdrop to avoid recreating radial gradients every frame
    const backdropCanvas = document.createElement('canvas');
    const backdropCtx = backdropCanvas.getContext('2d');

    // Mouse coordinates for gentle parallax interaction
    let targetMouseX = 0;
    let targetMouseY = 0;
    let currentMouseX = 0;
    let currentMouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      if (width === 0 || height === 0) return;
      targetMouseX = (e.clientX / width - 0.5) * 40;
      targetMouseY = (e.clientY / height - 0.5) * 40;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    let lastTimestamp = performance.now();

    const startLoopIfActive = () => {
      if (prefersReducedMotion || !isTabVisible || !isIntersecting || animationFrameId) {
        return;
      }
      lastTimestamp = performance.now();
      animationFrameId = requestAnimationFrame(render);
    };

    const stopLoop = () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = 0;
      }
    };

    // Handle tab visibility change
    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible && isIntersecting) {
        startLoopIfActive();
      } else {
        stopLoop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Pause animation when canvas leaves the viewport
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          isIntersecting = Boolean(entry?.isIntersecting);
          if (isIntersecting && isTabVisible) {
            startLoopIfActive();
          } else {
            stopLoop();
          }
        },
        { threshold: 0 }
      );
      observer.observe(canvas);
    }

    // Grid nodes representing clarity & structure
    let nodes: ParticleNode[] = [];

    const renderBackdropCache = () => {
      if (!backdropCtx || width === 0 || height === 0) return;
      backdropCanvas.width = Math.floor(width * currentDpr);
      backdropCanvas.height = Math.floor(height * currentDpr);
      backdropCtx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      backdropCtx.clearRect(0, 0, width, height);

      const centerGrad = backdropCtx.createRadialGradient(
        width * 0.5,
        height * 0.38,
        width * 0.05,
        width * 0.5,
        height * 0.5,
        width * 0.75
      );
      centerGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      centerGrad.addColorStop(0.45, 'rgba(252, 252, 253, 0.96)');
      centerGrad.addColorStop(1, 'rgba(245, 245, 247, 0.85)');
      backdropCtx.fillStyle = centerGrad;
      backdropCtx.fillRect(0, 0, width, height);
    };

    const resize = () => {
      currentDpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;

      canvas.width = Math.floor(width * currentDpr);
      canvas.height = Math.floor(height * currentDpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      renderBackdropCache();

      // Generate grid-aligned floating nodes based on screen size
      nodes = [];
      const density = width < 768 ? 22 : 38;
      
      for (let i = 0; i < density; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        nodes.push({
          x,
          y,
          baseX: x,
          baseY: y,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          radius: Math.random() * 2 + 1.2,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.0015 + 0.0008,
          ringRadius: Math.random() * 24 + 16,
          layer: Math.floor(Math.random() * 3)
        });
      }

      if (prefersReducedMotion) {
        drawStaticFallback();
      }
    };

    const drawStaticFallback = () => {
      ctx.clearRect(0, 0, width, height);

      // Soft architectural background gradient
      const bgGrad = ctx.createRadialGradient(width * 0.5, height * 0.35, 80, width * 0.5, height * 0.5, width * 0.8);
      bgGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      bgGrad.addColorStop(0.5, 'rgba(250, 250, 250, 1)');
      bgGrad.addColorStop(1, 'rgba(244, 244, 245, 1)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Delicate isometric / constellation lines
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.035)';
      ctx.lineWidth = 1;
      const step = 80;
      for (let x = 0; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Elegant focal rings
      ctx.strokeStyle = 'rgba(135, 206, 235, 0.28)';
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.42, 140, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(17, 17, 17, 0.04)';
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.42, 280, 0, Math.PI * 2);
      ctx.stroke();
    };

    window.addEventListener('resize', resize, { passive: true });
    resize();

    const maxDist = 135;
    const maxDistSq = maxDist * maxDist;

    const render = (now: number) => {
      animationFrameId = 0;
      if (!isTabVisible || !isIntersecting) return;

      const delta = Math.min((now - lastTimestamp) / 1000, 0.1);
      lastTimestamp = now;

      // Smooth mouse parallax damping
      currentMouseX += (targetMouseX - currentMouseX) * 0.05;
      currentMouseY += (targetMouseY - currentMouseY) * 0.05;

      ctx.clearRect(0, 0, width, height);

      // 1. Draw pre-rendered radial atmospheric backdrop
      if (backdropCanvas.width > 0 && backdropCanvas.height > 0) {
        ctx.drawImage(backdropCanvas, 0, 0, width, height);
      }

      // 2. Harmonic orbit rings at the center
      const centerX = width * 0.5 + currentMouseX * 0.2;
      const centerY = height * 0.42 + currentMouseY * 0.2;
      const time = now * 0.0006;

      ctx.lineWidth = 1;
      
      // Outer subtle breathing orbital
      ctx.strokeStyle = 'rgba(17, 17, 17, 0.035)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 280 + Math.sin(time) * 12, 0, Math.PI * 2);
      ctx.stroke();

      // Middle harmonic orbit
      ctx.strokeStyle = 'rgba(135, 206, 235, 0.25)'; // Sky blue signature
      ctx.beginPath();
      ctx.arc(centerX, centerY, 160 + Math.cos(time * 0.8) * 8, 0, Math.PI * 2);
      ctx.stroke();

      // Core focus ring
      ctx.strokeStyle = 'rgba(17, 17, 17, 0.06)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 80 + Math.sin(time * 1.2) * 4, 0, Math.PI * 2);
      ctx.stroke();

      // 3. Update & compute screen coordinates once per frame
      const len = nodes.length;
      const driftStep = 60 * delta;
      for (let i = 0; i < len; i++) {
        const node = nodes[i];
        node.x += node.vx * driftStep;
        node.y += node.vy * driftStep;

        if (node.x < -30) node.x = width + 30;
        else if (node.x > width + 30) node.x = -30;
        if (node.y < -30) node.y = height + 30;
        else if (node.y > height + 30) node.y = -30;
      }

      ctx.lineWidth = 0.8;
      for (let i = 0; i < len; i++) {
        const node = nodes[i];
        const pulse = Math.sin(now * node.speed + node.phase);
        const currentRadius = node.radius + pulse * 0.4;

        const layerMultiplier = (node.layer + 1) * 0.35;
        const renderX = node.x + currentMouseX * layerMultiplier;
        const renderY = node.y + currentMouseY * layerMultiplier;

        // Draw connections between nearby nodes using precomputed alpha LUT
        for (let j = i + 1; j < len; j++) {
          const other = nodes[j];
          const otherLayerMul = (other.layer + 1) * 0.35;
          const otherX = other.x + currentMouseX * otherLayerMul;
          const otherY = other.y + currentMouseY * otherLayerMul;

          const dx = renderX - otherX;
          const dy = renderY - otherY;
          const distSq = dx * dx + dy * dy;

          if (distSq < maxDistSq) {
            const ratio = 1 - Math.sqrt(distSq) / maxDist;
            const styleIdx = Math.min(EDGE_ALPHA_STEPS, Math.max(0, Math.round(ratio * EDGE_ALPHA_STEPS)));
            if (styleIdx > 0) {
              ctx.strokeStyle = EDGE_STROKE_STYLES[styleIdx];
              ctx.beginPath();
              ctx.moveTo(renderX, renderY);
              ctx.lineTo(otherX, otherY);
              ctx.stroke();
            }
          }
        }

        // Draw node center
        ctx.beginPath();
        ctx.arc(renderX, renderY, Math.max(0.5, currentRadius), 0, Math.PI * 2);
        if (node.layer === 2) {
          ctx.fillStyle = 'rgba(135, 206, 235, 0.75)'; // Sky blue accent for anchor nodes
        } else if (node.layer === 1) {
          ctx.fillStyle = 'rgba(17, 17, 17, 0.4)';
        } else {
          ctx.fillStyle = 'rgba(17, 17, 17, 0.15)';
        }
        ctx.fill();

        // Subtle surrounding aura on prominent nodes
        if (node.layer === 2) {
          ctx.beginPath();
          ctx.arc(renderX, renderY, node.ringRadius * (0.8 + pulse * 0.15), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(135, 206, 235, 0.12)';
          ctx.lineWidth = 0.75;
          ctx.stroke();
          ctx.lineWidth = 0.8;
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    startLoopIfActive();

    return () => {
      stopLoop();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none select-none ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Subtle top and bottom atmospheric fade gradients */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/70 via-transparent to-white/90" />
    </div>
  );
};
