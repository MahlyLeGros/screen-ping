import { useLayoutEffect, useRef, useState } from "react";
import MemeCaption from "./MemeCaption";
import { memeCaptionTextStyle } from "./memeCaptionStyle";
import { paddedCaptionSize } from "./captionMetrics";

interface ScaledMemeCaptionProps {
  text: string;
  fontSizePct?: number;
}

export default function ScaledMemeCaption({ text, fontSizePct = 10 }: ScaledMemeCaptionProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState({ sx: 1, sy: 1, w: 0, h: 0, ready: false });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;

    const update = () => {
      const wrapRect = wrap.getBoundingClientRect();
      const measureRect = measure.getBoundingClientRect();
      const { width: iw, height: ih } = paddedCaptionSize(measureRect.width, measureRect.height);
      if (iw <= 0 || ih <= 0 || wrapRect.width <= 0 || wrapRect.height <= 0) {
        setLayout({ sx: 1, sy: 1, w: 0, h: 0, ready: false });
        return;
      }
      setLayout({
        sx: wrapRect.width / iw,
        sy: wrapRect.height / ih,
        w: iw,
        h: ih,
        ready: true,
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [text, fontSizePct]);

  return (
    <div ref={wrapRef} className="meme-caption-scale-wrap">
      <span
        ref={measureRef}
        className="meme-caption-measurer"
        style={memeCaptionTextStyle(fontSizePct)}
        aria-hidden
      >
        {text}
      </span>
      {layout.ready && (
        <div
          className="meme-caption-scale-inner"
          style={{
            width: layout.w,
            height: layout.h,
            transform: `scale(${layout.sx}, ${layout.sy})`,
          }}
        >
          <MemeCaption text={text} fontSizePct={fontSizePct} />
        </div>
      )}
    </div>
  );
}
