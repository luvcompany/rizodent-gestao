import React from "react";

// Regex para URLs http(s):// — captura até espaço/quebra
const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;

export interface LinkifyResult {
  nodes: React.ReactNode[];
  urls: string[];
}

/**
 * Divide um texto em nós React, transformando URLs em links clicáveis.
 * Também retorna a lista de URLs encontradas (para gerar previews).
 */
export function linkify(text: string): LinkifyResult {
  if (!text) return { nodes: [text], urls: [] };
  const parts = text.split(URL_REGEX);
  const urls: string[] = [];
  const nodes: React.ReactNode[] = parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      // reset lastIndex porque test() em regex /g é stateful
      URL_REGEX.lastIndex = 0;
      urls.push(part);
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline break-all hover:opacity-80"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
  return { nodes, urls };
}
