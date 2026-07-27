import { Command, Prompt } from "@effect/cli";
import { HttpClient } from "@effect/platform";
import { Console, Effect } from "effect";
import { loadCredentials } from "../config.js";
import { apiRequest, ApiError, CLI_USER_AGENT } from "../http.js";
import { onQuit } from "../prompt-utils.js";

interface ThreadRow {
  readonly id: string;
}

const isThreadRow = (value: unknown): value is ThreadRow =>
  !!value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string";

const createOrReuseThread = (): Effect.Effect<string, ApiError | Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const thread = yield* apiRequest("POST", "/api/threads", { reuseEmpty: true });
    if (!isThreadRow(thread)) {
      return yield* Effect.fail(new Error("Server returned an unexpected response starting a chat thread."));
    }
    return thread.id;
  });

/** Issues one chat turn. Split out from `sendMessage` (previously one
 * ~66-line function doing request-building, error-body parsing, SSE
 * framing, and event rendering all at once) so each concern is independently
 * readable. Sets the same `User-Agent` every other CLI request sends
 * (`http.ts`'s `CLI_USER_AGENT`) — this call bypasses `apiRequest` entirely
 * (streaming a chunked SSE body through Effect's HTTP stream primitives
 * isn't worth it for one call site), and previously dropped that header as
 * a side effect of bypassing the shared client. */
const postChatTurn = (
  baseUrl: string,
  token: string,
  threadId: string,
  text: string,
  signal: AbortSignal,
): Promise<Response> =>
  fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "user-agent": CLI_USER_AGENT,
    },
    body: JSON.stringify({
      id: threadId,
      message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] },
    }),
  });

async function parseErrorResponse(response: Response): Promise<string> {
  let message = `Chat request failed (${response.status})`;
  try {
    const errorBody = (await response.json()) as { error?: string };
    if (typeof errorBody.error === "string") message = errorBody.error;
  } catch {
    // no JSON body — keep the generic message
  }
  return message;
}

/** `/api/chat` streams the Vercel AI SDK's UI-message-stream protocol
 * (`createUIMessageStreamResponse`, src/lib/chat/run-chat-turn.ts) — an SSE
 * body of `data: {type, ...}` lines. Yields each payload string as it's
 * framed. The trailing `decoder.decode()` call (no arguments) flushes any
 * multi-byte character left buffered mid-sequence at stream end — the
 * previous version never called this, silently dropping a trailing
 * character if a chunk boundary landed inside one. */
async function* readSseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice("data: ".length).trim();
        if (payload && payload !== "[DONE]") yield payload;
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith("data: ")) {
      const payload = buffer.slice("data: ".length).trim();
      if (payload && payload !== "[DONE]") yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}

function renderEvent(payload: string): void {
  try {
    const event = JSON.parse(payload) as { type?: string; delta?: string; errorText?: string };
    if (event.type === "text-delta" && typeof event.delta === "string") {
      process.stdout.write(event.delta);
    } else if (event.type === "error") {
      process.stdout.write(`\n[error: ${event.errorText ?? "unknown"}]\n`);
    }
  } catch {
    // a partial/malformed event line — skip it, don't crash the chat loop
  }
}

/** Wrapped in `Effect.tryPromise` (not `Effect.promise`) specifically so a
 * thrown/rejected error becomes a normal catchable Effect failure, not a
 * defect — see the same footgun documented in url.ts/config.ts. Passes the
 * Effect runtime's own interruption signal through to `fetch`, so
 * interrupting this fiber (Ctrl+C during a streaming turn) actually cancels
 * the in-flight request instead of abandoning it to keep running and
 * reading in the background. */
const sendMessage = (
  baseUrl: string,
  token: string,
  threadId: string,
  text: string,
): Effect.Effect<void, ApiError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await postChatTurn(baseUrl, token, threadId, text, signal);

      // Checked separately (not `!response.ok || !response.body`, which the
      // previous version used): a 200 with no body is a distinct, genuinely
      // contradictory server bug, not the same "request failed" case as a
      // non-2xx status, and deserves its own message rather than reporting
      // "Chat request failed (200)."
      if (!response.ok) {
        throw new ApiError({ status: response.status, message: await parseErrorResponse(response) });
      }
      if (!response.body) {
        throw new ApiError({ status: response.status, message: "Chat response had no body" });
      }

      for await (const payload of readSseLines(response.body)) {
        renderEvent(payload);
      }
      process.stdout.write("\n");
    },
    catch: (cause) =>
      cause instanceof ApiError
        ? cause
        : new ApiError({
            status: 0,
            message: cause instanceof Error ? cause.message : "Chat request failed",
          }),
  });

export const chatCommand = Command.make("chat", {}, () =>
  Effect.gen(function* () {
    const credentials = yield* loadCredentials();
    if (!credentials) {
      return yield* Effect.fail(new Error("Not signed in. Run `aftermerge auth login` first."));
    }

    const threadId = yield* createOrReuseThread();
    yield* Console.log("Chatting — type a message, or 'exit' to quit.\n");

    for (;;) {
      const input = yield* Prompt.run(Prompt.text({ message: "You" }));
      const trimmed = input.trim();
      if (trimmed.length === 0) continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      yield* Console.log("");
      yield* sendMessage(credentials.baseUrl, credentials.token, threadId, trimmed).pipe(
        // Per-message failures don't end the session — only starting the
        // chat (thread creation, sign-in) is fatal; a bad turn is retryable.
        Effect.catchAll((error) => Console.error(error.message)),
      );
      yield* Console.log("");
    }
  }).pipe(
    (effect) => onQuit(effect, "\nExiting chat."),
    Effect.tapError((error: Error | ApiError) => Console.error(error.message)),
  ),
).pipe(Command.withDescription("Chat with the repo (interactive)"));
