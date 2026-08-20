import { ChatThread } from "@/components/ui/chat-thread";
import { Markdown } from "@/components/ui/markdown";
import { Spinner } from "@/components/ui/spinner";
import { TextInput } from "@/components/ui/text-input";
import { useTheme } from "@/hooks/use-theme";
import { useTerminalDimensions } from "@opentui/react";
import { EmptyState, ErrorLine, ViewHeader } from "@/ui/chrome";

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly streaming?: boolean;
}

export interface ChatViewProps {
  messages?: ChatMessage[];
  input?: string;
  onInputChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  busy?: boolean;
  error?: string;
  /** When false, the input unmounts so the command palette can own the keyboard. */
  inputEnabled?: boolean;
}

export const ChatView = ({
  messages = [],
  input = "",
  onInputChange,
  onSubmit,
  busy = false,
  error,
  inputEnabled = true,
}: ChatViewProps) => {
  const theme = useTheme();
  const { width } = useTerminalDimensions();

  return (
    <box flexDirection="column" flexGrow={1}>
      <ViewHeader kicker="chat" title="Ask about this scan" />
      {error ? <ErrorLine>{error}</ErrorLine> : null}
      <box flexGrow={1} flexDirection="column" overflow="hidden">
        <ChatThread>
          {messages.length === 0 ? (
            <EmptyState>ask about this scan</EmptyState>
          ) : (
            messages.map((message) => (
              <box key={message.id} flexDirection="column" marginBottom={1}>
                <text fg={theme.colors.mutedForeground}>
                  {message.role === "user" ? "you" : "aftermerge"}
                </text>
                {message.role === "assistant" ? (
                  <Markdown>{message.content}</Markdown>
                ) : (
                  <text fg={theme.colors.foreground}>{message.content}</text>
                )}
                {message.streaming ? (
                  <Spinner type="line" color={theme.colors.mutedForeground} />
                ) : null}
              </box>
            ))
          )}
        </ChatThread>
      </box>
      {busy && messages.every((m) => !m.streaming) ? (
        <box marginBottom={1}>
          <Spinner
            type="line"
            label="thinking"
            color={theme.colors.mutedForeground}
          />
        </box>
      ) : null}
      {inputEnabled ? (
        <box
          flexShrink={0}
          border
          borderColor={theme.colors.border}
          borderStyle="single"
          paddingLeft={1}
          paddingRight={1}
          width={Math.max(24, width - 6)}
        >
          <TextInput
            value={input}
            onChange={onInputChange}
            onSubmit={onSubmit}
            placeholder="ask about this merge"
            bordered={false}
            paddingX={0}
            width={Math.max(22, width - 8)}
            cursor="█"
          />
        </box>
      ) : null}
    </box>
  );
};
