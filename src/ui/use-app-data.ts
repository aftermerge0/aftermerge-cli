import { Console, Effect, Fiber } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { clearCredentials, loadCredentials } from "@/config";
import {
  beginLogin,
  completeLogin,
  DEFAULT_AUTH_SERVER,
  ensureChatThread,
  listFindings,
  listRepos,
  loadSession,
  scanCurrentRepo,
  sendChatTurn,
  type DeviceCodeResponse,
  type RepoRow,
  type SessionUser,
} from "@/queries";
import { AppRuntime, sinkConsole } from "@/runtime";
import type { ParsedRoute } from "@/ui/route";
import type { AuthDevice, AuthStatus, AuthUser } from "@/ui/views/auth";
import type { ChatMessage } from "@/ui/views/chat";
import type { FindingRow } from "@/ui/views/finding-list";
import type { ScanProgress, ScanStatus } from "@/ui/views/scan";

const failMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
};

const toFindingRows = (
  findings: ReadonlyArray<{
    title: string;
    severity: string;
    band: string;
    description: string;
  }>,
): FindingRow[] =>
  findings.map((finding, i) => ({
    id: String(i),
    title: finding.title,
    severity: finding.severity,
    band: finding.band,
    description: finding.description,
  }));

const progressFromLog = (line: string): ScanProgress | undefined => {
  const text = line.trim().toLowerCase();
  if (text.length === 0) {
    return undefined;
  }
  if (text.includes("reading") && text.includes("base")) {
    return { value: 12, total: 100, label: "reading base" };
  }
  if (text.includes("indexing") && text.includes("base")) {
    return { value: 28, total: 100, label: "indexing base" };
  }
  if (text.includes("reading") && text.includes("head")) {
    return { value: 42, total: 100, label: "reading head" };
  }
  if (text.includes("indexing") && text.includes("head")) {
    return { value: 58, total: 100, label: "indexing head" };
  }
  if (text.includes("starting analysis") || text.includes("run id")) {
    return { value: 70, total: 100, label: "starting run" };
  }
  if (text.includes("pending")) {
    return { value: 78, total: 100, label: "pending" };
  }
  if (text.includes("running")) {
    return { value: 88, total: 100, label: "running" };
  }
  if (text.includes("completed") || text.includes("finding")) {
    return { value: 100, total: 100, label: "complete" };
  }
  return { value: 35, total: 100, label: line.trim().slice(0, 48) };
};

const interruptFiber = (fiber: Fiber.Fiber<unknown, unknown> | null): void => {
  if (fiber) {
    AppRuntime.runFork(Fiber.interrupt(fiber));
  }
};

export const useAppData = (initialRoute: ParsedRoute) => {
  const [user, setUser] = useState<AuthUser | undefined>(undefined);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("signed-out");
  const [device, setDevice] = useState<AuthDevice | undefined>(undefined);
  const [authError, setAuthError] = useState<string | undefined>(undefined);

  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | undefined>(undefined);

  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanProgress, setScanProgress] = useState<ScanProgress | undefined>(undefined);
  const [scanFindings, setScanFindings] = useState<FindingRow[]>([]);
  const [scanError, setScanError] = useState<string | undefined>(undefined);
  const [runId, setRunId] = useState<string | undefined>(undefined);

  const [selectedFinding, setSelectedFinding] = useState(0);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError, setFindingsError] = useState<string | undefined>(undefined);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | undefined>(undefined);
  const threadIdRef = useRef<string | undefined>(undefined);

  const scanFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null);
  const loginFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null);
  const chatFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null);
  const sessionFiber = useRef<Fiber.Fiber<unknown, unknown> | null>(null);

  const applySession = useCallback((session: SessionUser | null) => {
    if (!session) {
      setUser(undefined);
      setAuthStatus("signed-out");
      return;
    }
    setUser({ login: session.login, org: session.org });
    setAuthStatus("signed-in");
    setDevice(undefined);
    setAuthError(undefined);
  }, []);

  const refreshSession = useCallback(() => {
    interruptFiber(sessionFiber.current);
    sessionFiber.current = AppRuntime.runFork(
      loadSession().pipe(
        Effect.match({
          onFailure: (error) => {
            applySession(null);
            setAuthError(failMessage(error));
            setAuthStatus("error");
          },
          onSuccess: (session) => {
            applySession(session);
          },
        }),
      ),
    );
  }, [applySession]);

  const refreshRepos = useCallback(() => {
    setReposLoading(true);
    setReposError(undefined);
    AppRuntime.runFork(
      listRepos().pipe(
        Effect.match({
          onFailure: (error) => {
            setRepos([]);
            setReposError(failMessage(error));
            setReposLoading(false);
          },
          onSuccess: (rows) => {
            setRepos([...rows]);
            setReposLoading(false);
          },
        }),
      ),
    );
  }, []);

  const loadRunFindings = useCallback((id: string) => {
    setFindingsLoading(true);
    setFindingsError(undefined);
    AppRuntime.runFork(
      listFindings(id).pipe(
        Effect.match({
          onFailure: (error) => {
            setFindingsError(failMessage(error));
            setFindingsLoading(false);
          },
          onSuccess: (rows) => {
            const mapped = toFindingRows(rows);
            setScanFindings(mapped);
            setSelectedFinding(0);
            setFindingsLoading(false);
          },
        }),
      ),
    );
  }, []);

  const startScan = useCallback(() => {
    if (scanStatus === "running") {
      return;
    }
    interruptFiber(scanFiber.current);
    setScanStatus("running");
    setScanError(undefined);
    setScanFindings([]);
    setScanProgress({ value: 6, total: 100, label: "starting" });

    const effect = scanCurrentRepo(initialRoute.pr).pipe(
      Effect.provideService(
        Console.Console,
        sinkConsole((line) => {
          const next = progressFromLog(line);
          if (next) {
            setScanProgress(next);
          }
        }),
      ),
    );

    scanFiber.current = AppRuntime.runFork(
      effect.pipe(
        Effect.match({
          onFailure: (error) => {
            setScanStatus("failed");
            setScanError(failMessage(error));
            setScanProgress(undefined);
          },
          onSuccess: ({ runId: id }) => {
            setRunId(id);
            setScanStatus("completed");
            setScanProgress({ value: 100, total: 100, label: "complete" });
            loadRunFindings(id);
          },
        }),
      ),
    );
  }, [initialRoute.pr, loadRunFindings, scanStatus]);

  const startLogin = useCallback(() => {
    interruptFiber(loginFiber.current);
    setAuthStatus("waiting");
    setAuthError(undefined);
    setDevice(undefined);

    loginFiber.current = AppRuntime.runFork(
      Effect.gen(function* () {
        const code: DeviceCodeResponse = yield* beginLogin();
        yield* Effect.sync(() => {
          setDevice({
            userCode: code.user_code,
            verificationUrl: code.verification_uri_complete,
          });
        });
        yield* completeLogin(DEFAULT_AUTH_SERVER, code);
        const session = yield* loadSession();
        applySession(session);
      }).pipe(
        Effect.match({
          onFailure: (error) => {
            setAuthStatus("error");
            setAuthError(failMessage(error));
            setDevice(undefined);
          },
          onSuccess: () => {
            refreshRepos();
          },
        }),
      ),
    );
  }, [applySession, refreshRepos]);

  const logout = useCallback(() => {
    interruptFiber(loginFiber.current);
    AppRuntime.runFork(
      clearCredentials().pipe(
        Effect.match({
          onFailure: (error) => {
            setAuthStatus("error");
            setAuthError(failMessage(error));
          },
          onSuccess: () => {
            applySession(null);
            setRepos([]);
          },
        }),
      ),
    );
  }, [applySession]);

  const submitChat = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || chatBusy) {
        return;
      }
      setChatInput("");
      setChatError(undefined);
      setChatBusy(true);

      const userId = `u-${Date.now()}`;
      const assistantId = `a-${Date.now()}`;
      setChatMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);

      const appendDelta = (delta: string) => {
        setChatMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + delta }
              : message,
          ),
        );
      };

      const finishAssistant = (error?: string) => {
        setChatMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, streaming: false } : message,
          ),
        );
        setChatBusy(false);
        if (error) {
          setChatError(error);
        }
      };

      interruptFiber(chatFiber.current);
      chatFiber.current = AppRuntime.runFork(
        Effect.gen(function* () {
          const credentials = yield* loadCredentials();
          if (!credentials) {
            return yield* Effect.fail(new Error("Not signed in. Open Auth and press l."));
          }
          let threadId = threadIdRef.current;
          if (!threadId) {
            threadId = yield* ensureChatThread();
            threadIdRef.current = threadId;
          }
          yield* sendChatTurn(
            credentials.baseUrl,
            credentials.token,
            threadId,
            trimmed,
            (event) => {
              if (event._tag === "delta") {
                appendDelta(event.text);
              } else {
                finishAssistant(event.message);
              }
            },
          );
        }).pipe(
          Effect.match({
            onFailure: (error) => {
              finishAssistant(failMessage(error));
            },
            onSuccess: () => {
              finishAssistant();
            },
          }),
        ),
      );
    },
    [chatBusy],
  );

  const interruptAll = useCallback(() => {
    interruptFiber(scanFiber.current);
    interruptFiber(loginFiber.current);
    interruptFiber(chatFiber.current);
    interruptFiber(sessionFiber.current);
    scanFiber.current = null;
    loginFiber.current = null;
    chatFiber.current = null;
    sessionFiber.current = null;
  }, []);

  useEffect(() => {
    refreshSession();
    return () => {
      interruptAll();
    };
  }, [interruptAll, refreshSession]);

  useEffect(() => {
    if (user) {
      refreshRepos();
    }
  }, [refreshRepos, user]);

  useEffect(() => {
    if (initialRoute.pr !== undefined) {
      startScan();
    }
    // Deep-link scan fires once on boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRow = scanFindings[selectedFinding];

  return {
    user,
    authStatus,
    device,
    authError,
    repos,
    reposLoading,
    reposError,
    scanStatus,
    scanProgress,
    scanFindings,
    scanError,
    runId,
    selectedFinding,
    setSelectedFinding,
    selectedDetail: selectedRow?.description,
    findingsLoading,
    findingsError,
    chatMessages,
    chatInput,
    setChatInput,
    chatBusy,
    chatError,
    submitChat,
    startScan,
    startLogin,
    logout,
    interruptAll,
    pr: initialRoute.pr,
  };
};
