import { Command, Prompt } from "@effect/cli";
import { HttpClient } from "@effect/platform";
import { Console, Effect, Predicate } from "effect";
import { loadCredentials } from "../config.js";
import { apiRequest, ApiError } from "../http.js";

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

/** `/api/chat` streams the Vercel AI SDK's UI-message-stream protocol
 * (`createUIMessageStreamResponse`, src/lib/chat/run-chat-turn.ts) — an SSE
 * body of `data: {type, ...}` lines. This only extracts `text-delta` parts
 * for a plain-text terminal experience; tool calls/reasoning parts are
 * ignored (v1 scope). Uses plain `fetch` rather than `apiRequest`/
 * `@effect/platform`'s HttpClient because consuming a chunked body directly
 * is simpler than threading it through Effect's stream primitives here.
 * Wrapped in `Effect.tryPromise` (not `Effect.promise`) specifically so a
 * thrown/rejected error becomes a normal catchable Effect failure, not a
 * defect — see the same footgun documented in url.ts/browser.ts. */
const sendMessage = (
  baseUrl: string,
  token: string,
  threadId: string,
  text: string,
): Effect.Effect<void, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(new URL("/api/chat", baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: threadId,
          message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] },
        }),
      });

      if (!response.ok || !response.body) {
        let message = `Chat request failed (${response.status})`;
        try {
          const errorBody = (await response.json()) as { error?: string };
          if (typeof errorBody.error === "string") message = errorBody.error;
        } catch {
          // no JSON body — keep the generic message
        }
        throw new ApiError({ status: response.status, message });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice("data: ".length).trim();
          if (!payload || payload === "[DONE]") continue;
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
    Effect.catchAll((error) => {
      // Ctrl+C during a prompt is a deliberate, graceful exit — not a
      // failure. Anything else should still print and propagate so
      // BunRuntime.runMain's default teardown exits non-zero.
      if (Predicate.isTagged(error, "QuitException")) {
        return Console.log("\nExiting chat.");
      }
      return Effect.zipRight(Console.error(error.message), Effect.fail(error));
    }),
  ),
).pipe(Command.withDescription("Chat with the repo (interactive)"));
