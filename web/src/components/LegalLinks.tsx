import { Link } from "react-router-dom";

interface LegalLinksProps {
  className?: string;
}

export default function LegalLinks({ className = "" }: LegalLinksProps) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500 ${className}`}>
      <Link to="/mentions-legales" className="site-link cursor-pointer hover:text-slate-200 hover:underline">
        Legal notice
      </Link>
      <Link to="/cgu" className="site-link cursor-pointer hover:text-slate-200 hover:underline">
        Terms
      </Link>
      <Link to="/privacy" className="site-link cursor-pointer hover:text-slate-200 hover:underline">
        Privacy
      </Link>
      <Link to="/abuse" className="site-link cursor-pointer hover:text-slate-200 hover:underline">
        Report abuse
      </Link>
    </div>
  );
}
