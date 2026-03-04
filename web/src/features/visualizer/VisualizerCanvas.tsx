import { useEffect, useRef } from 'react';

type VisualizerCanvasProps = {
  levels: number[];
};

export function VisualizerCanvas({ levels }: VisualizerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!context) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);

    const barCount = levels.length;
    if (barCount === 0) {
      return;
    }

    const centerX = width / 2;
    const barWidth = Math.max(4, Math.floor(width / (barCount * 3)));
    const gap = Math.max(2, Math.floor(barWidth / 2));

    context.fillStyle = '#0f172a';

    levels.forEach((level, index) => {
      const clampedLevel = Math.max(0, Math.min(1, level));
      const barHeight = Math.max(4, clampedLevel * height);
      const y = (height - barHeight) / 2;
      const offset = index * (barWidth + gap) + gap;

      context.fillRect(centerX - offset - barWidth, y, barWidth, barHeight);
      context.fillRect(centerX + offset, y, barWidth, barHeight);
    });
  }, [levels]);

  return <canvas ref={canvasRef} width={420} height={140} aria-label="session visualizer" />;
}
