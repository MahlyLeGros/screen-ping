import LegalPageLayout from "../components/LegalPageLayout";
import SupportKofi from "../components/SupportKofi";
import { KOFI_URL } from "../content/support";

export default function LegalPaymentsPage() {
  return (
    <LegalPageLayout
      title="Payments, subscriptions, and refunds"
      intro="As of this page, Screen Ping does not offer a required paid plan. Ko-fi tips are optional and do not unlock extra features."
    >
      <section className="space-y-2">
        <h2 className="section-heading">Support the project</h2>
        <p>
          You can leave a voluntary tip on{" "}
          <a className="text-brand-300 underline" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
            Ko-fi
          </a>
          . This is not a subscription: a donation does not grant premium access.
        </p>
        <div className="pt-1">
          <SupportKofi />
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="section-heading">Current status</h2>
        <p>
          No paid plan is active right now. Before any monetization, this page will need to include prices,
          billing frequency, and cancellation, renewal, and refund terms.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="section-heading">What to specify before payments</h2>
        <ul className="list-inside list-disc space-y-1 text-slate-300">
          <li>legal identity of the operator and billing information;</li>
          <li>price including tax, currency, frequency, and renewal;</li>
          <li>cancellation and refund terms;</li>
          <li>VAT and tax obligations for the countries served.</li>
        </ul>
      </section>
    </LegalPageLayout>
  );
}
