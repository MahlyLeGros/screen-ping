import { memeCaptionTextStyle } from "./memeCaptionStyle";

interface MemeCaptionProps {
  text: string;
  fontSizePct?: number;
}

export default function MemeCaption({ text, fontSizePct = 10 }: MemeCaptionProps) {
  return (
    <div className="meme-caption-box">
      <span className="meme-caption-text" style={memeCaptionTextStyle(fontSizePct)}>
        {text}
      </span>
    </div>
  );
}
