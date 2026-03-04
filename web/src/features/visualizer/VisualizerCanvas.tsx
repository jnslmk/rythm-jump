import { useEffect, useRef } from 'react';

type VisualizerCanvasProps = {
  levels: number[];
};

type SideBarRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SideBarLayout = {
  left: SideBarRect;
  right: SideBarRect;
};

function clampLevel(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

export function computeSideBarLayout(levels: number[], width: number, height: number): SideBarLayout {
  const barWidth = Math.max(8, Math.floor(width / 12));
  const gap = Math.max(4, Math.floor(barWidth / 2));
  const maxBarHeight = Math.max(4, height - 8);
  const centerX = width / 2;
  const leftLevel = clampLevel(levels[0]);
  const rightLevel = clampLevel(levels[1]);
  const leftHeight = Math.max(4, leftLevel * maxBarHeight);
  const rightHeight = Math.max(4, rightLevel * maxBarHeight);

  return {
    left: {
      x: centerX - gap - barWidth,
      y: (height - leftHeight) / 2,
      width: barWidth,
      height: leftHeight
    },
    right: {
      x: centerX + gap,
      y: (height - rightHeight) / 2,
      width: barWidth,
      height: rightHeight
    }
  };
}

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

    context.fillStyle = '#0f172a';
    const layout = computeSideBarLayout(levels, width, height);
    context.fillRect(layout.left.x, layout.left.y, layout.left.width, layout.left.height);
    context.fillRect(layout.right.x, layout.right.y, layout.right.width, layout.right.height);
  }, [levels]);

  return <canvas ref={canvasRef} width={420} height={140} aria-label="session visualizer" />;
}
