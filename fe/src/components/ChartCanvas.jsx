import { useEffect, useRef } from 'react';
import { destroyChart } from '../lib/charts';

export default function ChartCanvas({ draw, tall }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    draw(canvas);
    return () => destroyChart(canvas);
  }, [draw]);

  return (
    <div className={`chart-box ${tall ? 'tall' : ''}`}>
      <canvas ref={ref} />
    </div>
  );
}
