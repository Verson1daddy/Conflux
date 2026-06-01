import type { FC } from "react";
import type { DiscussionReviewSnapshot } from "@/lib/discussion-review";

interface DiscussionReviewModalProps {
  visible: boolean;
  snapshot: DiscussionReviewSnapshot | null;
  onClose: () => void;
}

const COLORS = {
  panel: "#FAF8F5",
  card: "#FFFFFF",
  border: "#D4CFC9",
  text: "#1A1A1A",
  body: "#5A5A5A",
  muted: "#8A8A8A",
  accent: "#B8D4E3",
  warningBg: "#FFF4DB",
  warningText: "#9E6B00",
};

const formatSavedAt = (savedAt: number): string => {
  return new Date(savedAt).toLocaleString();
};

const dispositionLabel = (disposition: DiscussionReviewSnapshot["disposition"]): string => {
  if (disposition === "saved") return "Saved";
  if (disposition === "discarded") return "Discarded";
  return "Pending review";
};

const DiscussionReviewModal: FC<DiscussionReviewModalProps> = ({
  visible,
  snapshot,
  onClose,
}) => {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Last Discussion Review"
      style={{
        background: "rgba(26,26,26,0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 560,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "78vh",
          borderRadius: 16,
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          boxShadow: "0 24px 64px rgba(0,0,0,0.42)",
        }}
      >
        <div
          className="flex items-center"
          style={{
            minHeight: 58,
            padding: "0 18px 0 22px",
            borderBottom: `1px solid ${COLORS.border}`,
            gap: 12,
          }}
        >
          <div className="flex flex-col flex-1 min-w-0" style={{ gap: 2 }}>
            <h2
              style={{
                margin: 0,
                color: COLORS.text,
                fontFamily: "'Fraunces Variable', Georgia, serif",
                fontSize: 20,
                fontWeight: 700,
              }}
            >
              Last Discussion Review
            </h2>
            {snapshot && (
              <span
                style={{
                  color: COLORS.muted,
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 11,
                }}
              >
                Saved {formatSavedAt(snapshot.saved_at)} · {dispositionLabel(snapshot.disposition)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close discussion review"
            title="Close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.card,
              color: COLORS.muted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: "26px",
            }}
          >
            ×
          </button>
        </div>

        {!snapshot ? (
          <div
            className="flex items-center justify-center"
            style={{
              minHeight: 220,
              padding: 28,
              color: COLORS.muted,
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 13,
            }}
          >
            No saved discussion review yet.
          </div>
        ) : (
          <div
            className="flex flex-col overflow-y-auto"
            style={{ padding: 22, gap: 14 }}
          >
            <section
              className="flex flex-col"
              style={{
                gap: 8,
                padding: 16,
                borderRadius: 12,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <div className="flex items-center" style={{ gap: 8 }}>
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: 9999,
                    background: COLORS.accent,
                    color: "#FFFFFF",
                    fontFamily: "'Geist Sans', sans-serif",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {snapshot.summary.total_rounds} rounds
                </span>
                <h3
                  style={{
                    margin: 0,
                    color: COLORS.text,
                    fontFamily: "'Geist Sans', sans-serif",
                    fontSize: 15,
                    fontWeight: 700,
                  }}
                >
                  {snapshot.summary.topic}
                </h3>
              </div>
              <p
                style={{
                  margin: 0,
                  color: COLORS.body,
                  fontFamily: "'Geist Sans', sans-serif",
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                {snapshot.summary.summary_text}
              </p>
            </section>

            <div className="flex items-center" style={{ gap: 8 }}>
              <Metric label="artifacts" value={snapshot.artifact_counts.total} />
              <Metric label="pinned" value={snapshot.artifact_counts.pinned} />
              <Metric label="draft" value={snapshot.artifact_counts.draft} />
              <Metric label="messages" value={snapshot.messages.length} />
            </div>

            {snapshot.artifacts.length > 0 && (
              <section className="flex flex-col" style={{ gap: 8 }}>
                {snapshot.artifacts.slice(0, 6).map((artifact) => (
                  <div
                    key={artifact.id}
                    className="flex items-start"
                    style={{
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    <span
                      style={{
                        padding: "2px 7px",
                        borderRadius: 9999,
                        background:
                          artifact.status === "pinned" ? COLORS.warningBg : "#F5F0EB",
                        color:
                          artifact.status === "pinned"
                            ? COLORS.warningText
                            : COLORS.muted,
                        fontFamily: "'Geist Sans', sans-serif",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {artifact.status}
                    </span>
                    <div className="flex flex-col flex-1 min-w-0" style={{ gap: 4 }}>
                      <span
                        style={{
                          color: COLORS.text,
                          fontFamily: "'Geist Sans', sans-serif",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {(artifact.lang || "Code").toUpperCase()} - {artifact.authorName} R
                        {artifact.round}
                      </span>
                      <pre
                        style={{
                          margin: 0,
                          color: COLORS.body,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          lineHeight: 1.45,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {artifact.content.split("\n").slice(0, 3).join("\n")}
                      </pre>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Metric: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div
    className="flex flex-col"
    style={{
      flex: 1,
      minWidth: 0,
      gap: 2,
      padding: "10px 12px",
      borderRadius: 10,
      background: COLORS.card,
      border: `1px solid ${COLORS.border}`,
    }}
  >
    <span
      style={{
        color: COLORS.text,
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 16,
        fontWeight: 700,
      }}
    >
      {value}
    </span>
    <span
      style={{
        color: COLORS.muted,
        fontFamily: "'Geist Sans', sans-serif",
        fontSize: 10,
      }}
    >
      {label}
    </span>
  </div>
);

export { DiscussionReviewModal };
