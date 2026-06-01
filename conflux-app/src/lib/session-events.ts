import type { SessionEvent } from "@/types";

type SessionEventLike = Pick<SessionEvent, "event_type" | "data">;
type JsonRecord = Record<string, unknown>;

export function summarizeSessionEvent(event: SessionEventLike): string {
  const parsed = parseSessionEventData(event);
  if (!parsed) {
    return truncate(event.data, 120);
  }

  const { eventType, payload } = parsed;

  if (eventType === "PtyOutput") {
    const encoded = stringField(payload, "data");
    const byteLength = encoded ? getBase64DecodedLength(encoded) : null;
    return byteLength === null
      ? "Terminal output chunk"
      : `Terminal output chunk (${byteLength} bytes)`;
  }

  const oldStatus = stringField(payload, "old_status");
  const newStatus = stringField(payload, "new_status");
  if (oldStatus && newStatus) {
    return `${oldStatus} -> ${newStatus}`;
  }

  const messagePayload = recordField(payload, "message");
  const messageContent = messagePayload
    ? stringField(messagePayload, "content")
    : null;
  if (messageContent) {
    return truncate(messageContent, 120);
  }

  const requestPayload = recordField(payload, "request");
  const requestSummary = requestPayload
    ? firstStringField(requestPayload, ["summary", "operation", "tool_name", "path"])
    : null;
  if (requestSummary) {
    return truncate(`Permission requested: ${requestSummary}`, 120);
  }

  const directSummary = firstStringField(payload, [
    "summary",
    "result_summary",
    "error_message",
    "command_text",
    "content",
    "content_preview",
    "action",
  ]);
  if (directSummary) {
    return truncate(directSummary, 120);
  }

  if (eventType === "ProcessExited") {
    const signal = stringField(payload, "signal");
    const exitCode = payload.exit_code;
    if (signal) {
      return `Process exited by ${signal}`;
    }
    if (typeof exitCode === "number") {
      return `Process exited with code ${exitCode}`;
    }
    return "Process exited";
  }

  return `${eventType} event`;
}

export function hasTerminalOutputEvents(events: SessionEventLike[]): boolean {
  return events.some((event) => {
    const parsed = parseSessionEventData(event);
    return event.event_type === "PtyOutput" || parsed?.eventType === "PtyOutput";
  });
}

function parseSessionEventData(
  event: SessionEventLike
): { eventType: string; payload: JsonRecord } | null {
  try {
    const parsed = JSON.parse(event.data) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return null;
    }

    const taggedType = stringField(record, "type");
    const taggedPayload = recordField(record, "payload");
    if (taggedType && taggedPayload) {
      return { eventType: taggedType, payload: taggedPayload };
    }

    const entries = Object.entries(record);
    if (entries.length === 1) {
      const [eventType, payload] = entries[0];
      const payloadRecord = asRecord(payload);
      if (payloadRecord) {
        return { eventType, payload: payloadRecord };
      }
    }

    return { eventType: event.event_type, payload: record };
  } catch {
    return null;
  }
}

function firstStringField(
  record: JsonRecord,
  fieldNames: readonly string[]
): string | null {
  for (const fieldName of fieldNames) {
    const value = stringField(record, fieldName);
    if (value) {
      return value;
    }
  }
  return null;
}

function stringField(record: JsonRecord, fieldName: string): string | null {
  const value = record[fieldName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordField(record: JsonRecord, fieldName: string): JsonRecord | null {
  return asRecord(record[fieldName]);
}

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

function getBase64DecodedLength(value: string): number | null {
  const sanitized = value.replace(/\s/g, "");
  if (sanitized.length === 0 || sanitized.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(sanitized)) {
    return null;
  }
  const padding = sanitized.endsWith("==") ? 2 : sanitized.endsWith("=") ? 1 : 0;
  return Math.max(0, (sanitized.length * 3) / 4 - padding);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}
