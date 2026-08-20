import React from "react";

import { useTheme } from "@/hooks/use-theme";

export interface MarkdownProps {
  children: string;
  width?: number;
}

interface InlineSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: boolean;
  url?: string;
}

const parseInline = (line: string): InlineSegment[] => {
  const segments: InlineSegment[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    if (match.index > last) {
      segments.push({ text: line.slice(last, match.index) });
    }

    const [full] = match;
    if (full.startsWith("**")) {
      segments.push({ bold: true, text: match[2] });
    } else if (full.startsWith("*")) {
      segments.push({ italic: true, text: match[3] });
    } else if (full.startsWith("`")) {
      segments.push({ code: true, text: match[4] });
    } else if (full.startsWith("[")) {
      segments.push({ link: true, text: match[5], url: match[6] });
    }

    last = match.index + full.length;
  }

  if (last < line.length) {
    segments.push({ text: line.slice(last) });
  }

  return segments;
};

/**
 * Renders one source line as a single wrapping <text>. Segments are spans so
 * long lines soft-wrap on words instead of overflowing the thread.
 */
const InlineLine = ({ segments }: { segments: InlineSegment[] }) => {
  const theme = useTheme();

  return (
    <text fg={theme.colors.foreground} wrapMode="word">
      {segments.map((seg, i) => {
        if (seg.code) {
          return (
            <span key={i} fg={theme.colors.accent}>
              {seg.text}
            </span>
          );
        }
        if (seg.link) {
          return (
            <span key={i}>
              <u>
                <span fg={theme.colors.info}>{seg.text}</span>
              </u>
              <span fg={theme.colors.mutedForeground}>{` (${seg.url})`}</span>
            </span>
          );
        }
        if (seg.bold && seg.italic) {
          return (
            <b key={i}>
              <i>{seg.text}</i>
            </b>
          );
        }
        if (seg.bold) {
          return <b key={i}>{seg.text}</b>;
        }
        if (seg.italic) {
          return <i key={i}>{seg.text}</i>;
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </text>
  );
};

export const Markdown = ({ children, width }: MarkdownProps) => {
  const theme = useTheme();
  const lines = children.split("\n");

  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      elements.push(
        <box key={`fence-${i}`} flexDirection="column" paddingLeft={2}>
          {body.map((codeLine, j) => (
            <text key={j} fg={theme.colors.accent}>
              {codeLine}
            </text>
          ))}
        </box>
      );
      continue;
    }

    const h4 = line.match(/^####\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);

    if (h1) {
      elements.push(
        <text key={i} fg={theme.colors.primary} wrapMode="word">
          <b>{h1[1]}</b>
        </text>
      );
    } else if (h2) {
      elements.push(
        <text key={i} fg={theme.colors.primary} wrapMode="word">
          <b>{h2[1]}</b>
        </text>
      );
    } else if (h3) {
      elements.push(
        <text key={i} fg={theme.colors.primary} wrapMode="word">
          <b>{h3[1]}</b>
        </text>
      );
    } else if (h4) {
      elements.push(
        <text key={i} fg={theme.colors.primary} wrapMode="word">
          {h4[1]}
        </text>
      );
    } else if (/^---+$/.test(line)) {
      elements.push(
        <text key={i} fg={theme.colors.border}>
          {"─".repeat(width ?? 40)}
        </text>
      );
    } else if (/^>\s/.test(line)) {
      const content = line.replace(/^>\s/, "");
      elements.push(
        <box key={i} flexDirection="row" gap={1}>
          <text fg={theme.colors.primary}>│</text>
          <box flexGrow={1} flexShrink={1}>
            <InlineLine segments={parseInline(content)} />
          </box>
        </box>
      );
    } else if (/^\s*[-*]\s/.test(line)) {
      const indent = (line.match(/^\s*/)?.[0].length ?? 0) >= 2 ? 2 : 0;
      const content = line.replace(/^\s*[-*]\s/, "");
      elements.push(
        <box key={i} flexDirection="row" gap={1} paddingLeft={indent}>
          <text fg={theme.colors.mutedForeground}>•</text>
          <box flexGrow={1} flexShrink={1}>
            <InlineLine segments={parseInline(content)} />
          </box>
        </box>
      );
    } else if (line.trim() === "") {
      elements.push(<box key={i} height={1} />);
    } else {
      elements.push(
        <box key={i} flexDirection="column">
          <InlineLine segments={parseInline(line)} />
        </box>
      );
    }

    i += 1;
  }

  return (
    <box flexDirection="column" width={width}>
      {elements}
    </box>
  );
};
