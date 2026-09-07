import LegalPageLayout from "../components/LegalPageLayout";
import { LEGAL_CONTACT } from "../content/legal";

export default function LegalMentionsPage() {
  return (
    <LegalPageLayout
      title="Legal notice"
      intro="Information about the publisher of the service, hosting, and how to get in touch."
    >
      <section className="space-y-2">
        <h2 className="section-heading">Publisher</h2>
        <p>
          The service is published under the name <strong>{LEGAL_CONTACT.publisherName}</strong>. Before
          large-scale commercial use, replace this section with your full legal identity (name, legal form,
          address, and registration number if applicable).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Contact</h2>
        <p>
          General contact: <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.publisherEmail}`}>{LEGAL_CONTACT.publisherEmail}</a>
        </p>
        <p>
          Legal contact: <a className="text-brand-300 underline" href={`mailto:${LEGAL_CONTACT.legalEmail}`}>{LEGAL_CONTACT.legalEmail}</a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Hosting</h2>
        <p>
          Host: <strong>{LEGAL_CONTACT.hostName}</strong>
        </p>
        <p>{LEGAL_CONTACT.hostAddress}</p>
      </section>

      <section className="space-y-2">
        <h2 className="section-heading">Publication</h2>
        <p>
          Publication director: to be completed by the operator of the service before commercial launch.
        </p>
        <p className="text-xs text-slate-500">Last updated: {LEGAL_CONTACT.lastUpdated}</p>
      </section>
    </LegalPageLayout>
  );
}
