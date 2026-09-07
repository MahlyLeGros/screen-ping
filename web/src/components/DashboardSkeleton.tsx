import ComposeColumnGlows from "./ComposeColumnGlows";
import Skeleton from "./Skeleton";

function SavedRow() {
  return (
    <div className="list-row">
      <Skeleton className="h-3 w-2/3 max-w-[10rem]" rounded="sm" />
      <div className="flex shrink-0 gap-1.5">
        <Skeleton className="h-7 w-12" rounded="lg" />
        <Skeleton className="h-7 w-14" rounded="lg" />
      </div>
    </div>
  );
}

function RecentRow() {
  return (
    <div className="list-row">
      <Skeleton className="h-3 w-3/4 max-w-[12rem]" rounded="sm" />
      <Skeleton className="h-5 w-16 shrink-0" rounded="full" />
    </div>
  );
}

function RecipientTile() {
  return (
    <div className="friend-tile friend-tile-compact">
      <Skeleton className="size-11 shrink-0" rounded="full" />
      <Skeleton className="h-3 w-14" rounded="sm" />
    </div>
  );
}

function CaptionSlider() {
  return (
    <div className="precision-slider">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-20" rounded="sm" />
        <Skeleton className="h-3 w-10" rounded="sm" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-2 min-w-0 flex-1" rounded="full" />
        <Skeleton className="h-8 w-[5.5rem] shrink-0" rounded="lg" />
      </div>
    </div>
  );
}

export default function DashboardSkeleton() {
  return (
    <div className="flex min-h-0 flex-col xl:flex-1" aria-busy="true" aria-label="Loading dashboard">
      <span className="sr-only" role="status">
        Loading dashboard
      </span>
      <div
        id="panel-send"
        className="flex min-h-0 flex-col gap-3 overflow-visible xl:flex-1"
      >
        <div className="compose-layout compose-layout-fill">
          <ComposeColumnGlows />
          <section
            className="compose-recipients-mobile compose-mobile-block order-0 panel p-3 xl:hidden"
            aria-hidden
          >
            <h3 className="form-section-title mb-2">To</h3>
            <div className="flex flex-wrap items-stretch gap-2">
              <RecipientTile />
              <RecipientTile />
              <RecipientTile />
            </div>
          </section>

          <aside className="compose-side compose-side-left panel order-2 flex min-h-0 flex-col gap-3 p-3 sm:p-4 xl:order-none">
            <section className="form-section compose-side-panel compose-side-saved flex min-h-0 flex-1 flex-col overflow-hidden">
              <h3 className="form-section-title">Saved pings</h3>
              <div className="scroll-area compose-side-saved-list mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                <SavedRow />
                <SavedRow />
                <SavedRow />
              </div>
            </section>
            <section className="form-section compose-side-panel compose-side-recent flex min-h-0 flex-1 flex-col overflow-hidden">
              <h3 className="form-section-title">Recent sends</h3>
              <div className="scroll-area compose-side-recent-list mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                <RecentRow />
                <RecentRow />
                <RecentRow />
                <RecentRow />
              </div>
            </section>
          </aside>

          <div className="compose-center-col order-1 flex min-h-0 flex-col xl:order-none">
            <section className="compose-center compose-center-fill panel flex flex-col p-1 sm:p-1.5 xl:h-full xl:min-h-0">
              <div className="compose-center-stack flex flex-col xl:min-h-0 xl:flex-1">
                <div className="compose-preview-column flex flex-col items-center xl:min-h-0 xl:flex-1">
                  <div className="compose-preview-stack w-full xl:min-h-0 xl:flex-1">
                    <div className="compose-preview-grow w-full">
                      <div className="compose-preview-slot">
                        <Skeleton className="compose-preview-editor h-full w-full" rounded="lg" />
                      </div>
                    </div>
                    <section className="compose-recipients-bar hidden shrink-0 xl:flex" aria-hidden>
                      <div className="min-w-0 flex-1">
                        <div className="flex h-full items-stretch gap-2">
                          <RecipientTile />
                          <RecipientTile />
                          <RecipientTile />
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside className="compose-side compose-side-right panel order-3 flex min-h-0 flex-col gap-3 p-3 sm:p-4 xl:order-none">
            <div className="compose-side-right-body min-h-0 flex-1 space-y-3">
              <section className="form-section space-y-2.5">
                <h3 className="form-section-title">Media</h3>
                <div>
                  <span className="field-label">File</span>
                  <Skeleton className="h-14 w-full" rounded="xl" />
                </div>
                <div>
                  <span className="field-label">Sound</span>
                  <Skeleton className="h-11 w-full" rounded="xl" />
                </div>
                <Skeleton className="h-10 w-full" rounded="lg" />
              </section>
              <section className="form-section space-y-3">
                <h3 className="form-section-title">Caption &amp; timing</h3>
                <div>
                  <span className="field-label">Caption</span>
                  <div className="flex gap-2">
                    <Skeleton className="h-[42px] min-w-0 flex-1" rounded="lg" />
                    <Skeleton className="h-[42px] w-[42px] shrink-0" rounded="lg" />
                  </div>
                </div>
                <div className="space-y-3">
                  <CaptionSlider />
                  <CaptionSlider />
                  <CaptionSlider />
                  <CaptionSlider />
                </div>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
