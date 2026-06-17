// =============================================================================
// RichTextEditor — wrapper Tiptap usado em descrição da demanda e comentários.
// =============================================================================
// Decisões:
// - StarterKit cobre B, I, listas, blockquote, code, heading; desligamos só o
//   que não usamos (HR, codeBlock formal — `code` inline basta).
// - Link extension com autolink: cola URL e vira link automaticamente.
// - Placeholder via extensão oficial.
// - autoFocus opt-in: o drawer não foca (evita roubar foco em scroll),
//   mas o form de comentário pode pedir.
// - onChange é debounced no consumidor (drawer faz flush no blur; comentário
//   só dispara no submit), aqui só repassamos.
// - Paste rich text é nativo do tiptap; HTML colado é normalizado contra o
//   schema dos plugins ativos — qualquer coisa fora é descartada com graça.
// - Mention opcional: quando `mentionProfiles` é fornecido, habilita extension
//   com dropdown próprio (sem Tippy). Salvamos como `<span data-type="mention"
//   data-id="...">@nome</span>` — sanitizer e extractMentionIdsFromHtml já
//   conhecem esse formato.
// =============================================================================

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import type { AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import type { ProfileOption } from "../lib/lookups";

export type RichTextVariant = "full" | "compact";

type MentionState = {
  open: boolean;
  items: ProfileOption[];
  selectedIndex: number;
  coords: { left: number; top: number } | null;
  command: ((item: { id: string; label: string }) => void) | null;
};

const EMPTY_MENTION_STATE: MentionState = {
  open: false,
  items: [],
  selectedIndex: 0,
  coords: null,
  command: null,
};

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  variant = "full",
  autoFocus = false,
  minHeight,
  mentionProfiles,
}: {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  variant?: RichTextVariant;
  autoFocus?: boolean;
  minHeight?: number;
  mentionProfiles?: ProfileOption[];
}) {
  // Mantemos o state da sugestão fora do editor para poder renderizar em portal.
  const [mention, setMention] = useState<MentionState>(EMPTY_MENTION_STATE);
  // Refs estáveis pra callbacks do tiptap (que são criados uma vez na config).
  const mentionRef = useRef(mention);
  mentionRef.current = mention;
  const profilesRef = useRef(mentionProfiles);
  profilesRef.current = mentionProfiles;

  const filterProfiles = useCallback((query: string): ProfileOption[] => {
    const all = profilesRef.current ?? [];
    if (!query) return all.slice(0, 8);
    const q = query.toLowerCase();
    return all
      .filter((p) => p.full_name.toLowerCase().includes(q))
      .slice(0, 8);
  }, []);

  const extensions = useMemo(() => {
    const exts: AnyExtension[] = [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        horizontalRule: false,
        // StarterKit v3 já inclui Link; desligamos pra usar nossa config custom
        // abaixo (autolink + linkOnPaste + classes próprias).
        link: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
          class: "text-tng-orange-300 underline underline-offset-2 hover:text-tng-orange-200",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "",
        emptyEditorClass: "is-editor-empty",
      }),
    ];

    if (mentionProfiles) {
      exts.push(
        Mention.configure({
          HTMLAttributes: { class: "tng-mention" },
          renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
          suggestion: {
            items: ({ query }) => filterProfiles(query),
            render: () => {
              return {
                onStart: (props) => {
                  const items = props.items as ProfileOption[];
                  const rect = props.clientRect?.();
                  setMention({
                    open: true,
                    items,
                    selectedIndex: 0,
                    coords: rect ? { left: rect.left, top: rect.bottom + 4 } : null,
                    command: (item) => props.command(item),
                  });
                },
                onUpdate: (props) => {
                  const items = props.items as ProfileOption[];
                  const rect = props.clientRect?.();
                  setMention((prev) => ({
                    ...prev,
                    open: true,
                    items,
                    selectedIndex: 0,
                    coords: rect ? { left: rect.left, top: rect.bottom + 4 } : prev.coords,
                    command: (item) => props.command(item),
                  }));
                },
                onKeyDown: (props) => {
                  const state = mentionRef.current;
                  if (!state.open) return false;
                  const len = state.items.length;
                  if (props.event.key === "ArrowDown") {
                    if (len === 0) return true;
                    setMention((s) => ({
                      ...s,
                      selectedIndex: (s.selectedIndex + 1) % len,
                    }));
                    return true;
                  }
                  if (props.event.key === "ArrowUp") {
                    if (len === 0) return true;
                    setMention((s) => ({
                      ...s,
                      selectedIndex: (s.selectedIndex - 1 + len) % len,
                    }));
                    return true;
                  }
                  if (props.event.key === "Enter" || props.event.key === "Tab") {
                    if (len === 0) return false;
                    const item = state.items[state.selectedIndex];
                    state.command?.({ id: item.id, label: item.full_name });
                    return true;
                  }
                  if (props.event.key === "Escape") {
                    setMention(EMPTY_MENTION_STATE);
                    return true;
                  }
                  return false;
                },
                onExit: () => {
                  setMention(EMPTY_MENTION_STATE);
                },
              };
            },
          },
        }),
      );
    }
    return exts;
    // mentionProfiles é redeclarado a cada render; só o "tem ou não tem" muda a
    // config — recriar o editor toda vez que a lista muda perderia foco. Usamos
    // ref interno (profilesRef) pra ler a versão mais nova nos callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(mentionProfiles)]);

  const editor = useEditor({
    extensions,
    content: value || "",
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class: editorClass(variant, minHeight),
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
    onBlur() {
      onBlur?.();
    },
  });

  // Quando o `value` externo muda (outra demanda selecionada, reset após
  // submit), atualiza o editor sem disparar onUpdate.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  return (
    <div className={wrapperClass(variant)}>
      <Toolbar editor={editor} variant={variant} />
      <EditorContent editor={editor} />
      {mention.open && mention.coords && mention.items.length > 0 && (
        <MentionDropdown
          items={mention.items}
          selectedIndex={mention.selectedIndex}
          coords={mention.coords}
          onPick={(item) => {
            mention.command?.({ id: item.id, label: item.full_name });
          }}
          onHover={(idx) => setMention((s) => ({ ...s, selectedIndex: idx }))}
        />
      )}
    </div>
  );
}

function MentionDropdown({
  items,
  selectedIndex,
  coords,
  onPick,
  onHover,
}: {
  items: ProfileOption[];
  selectedIndex: number;
  coords: { left: number; top: number };
  onPick: (item: ProfileOption) => void;
  onHover: (idx: number) => void;
}) {
  return createPortal(
    <ul
      role="listbox"
      style={{ left: coords.left, top: coords.top }}
      className="fixed z-[100] max-h-56 w-56 overflow-y-auto rounded-md border border-tng-marine-600 bg-tng-marine-800 py-1 shadow-xl"
    >
      {items.map((item, idx) => (
        <li
          key={item.id}
          role="option"
          aria-selected={idx === selectedIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item);
          }}
          onMouseEnter={() => onHover(idx)}
          className={[
            "cursor-pointer px-2.5 py-1.5 text-xs",
            idx === selectedIndex
              ? "bg-tng-orange-400/20 text-tng-orange-100"
              : "text-tng-marine-100 hover:bg-tng-marine-700",
          ].join(" ")}
        >
          @{item.full_name}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

function wrapperClass(variant: RichTextVariant): string {
  if (variant === "compact") {
    return "rich-editor rich-editor-compact rounded-md border border-tng-marine-600 bg-tng-marine-800 focus-within:border-tng-orange-400";
  }
  return "rich-editor rounded-md border border-tng-marine-600 bg-tng-marine-800 focus-within:border-tng-orange-400";
}

function editorClass(variant: RichTextVariant, minHeight?: number): string {
  const base =
    "prose-rich block w-full px-3 py-2 text-sm leading-relaxed text-tng-marine-100 placeholder:text-tng-marine-400 focus:outline-none";
  if (variant === "compact") {
    return `${base} max-h-60 min-h-[3rem] overflow-y-auto`;
  }
  const h = minHeight ?? 160;
  return `${base} min-h-[${h}px] max-h-[24rem] overflow-y-auto`;
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({ editor, variant }: { editor: Editor; variant: RichTextVariant }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-tng-marine-700 bg-tng-marine-800/60 px-1.5 py-1">
      <ToolbarButton
        editor={editor}
        label="B"
        title="Negrito (⌘B)"
        bold
        isActive={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        editor={editor}
        label="I"
        title="Itálico (⌘I)"
        italic
        isActive={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        editor={editor}
        label="S"
        title="Tachado"
        strike
        isActive={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <ToolbarButton
        editor={editor}
        label="‹/›"
        title="Código inline"
        mono
        isActive={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      />
      <Divider />
      <ToolbarButton
        editor={editor}
        label="• Lista"
        title="Lista com marcadores"
        isActive={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        editor={editor}
        label="1. Lista"
        title="Lista numerada"
        isActive={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      {variant === "full" && (
        <>
          <Divider />
          <ToolbarButton
            editor={editor}
            label="H2"
            title="Título"
            isActive={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            editor={editor}
            label="H3"
            title="Subtítulo"
            isActive={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <ToolbarButton
            editor={editor}
            label="❝"
            title="Citação"
            isActive={editor.isActive("blockquote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
        </>
      )}
      <Divider />
      <LinkButton editor={editor} />
    </div>
  );
}

function ToolbarButton({
  label,
  title,
  isActive,
  onClick,
  bold,
  italic,
  strike,
  mono,
}: {
  editor: Editor;
  label: string;
  title: string;
  isActive: boolean;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={[
        "rounded px-1.5 py-0.5 text-[11px] transition",
        bold ? "font-semibold" : "",
        italic ? "italic" : "",
        strike ? "line-through" : "",
        mono ? "font-mono" : "",
        isActive
          ? "bg-tng-orange-400/20 text-tng-orange-300"
          : "text-tng-marine-200 hover:bg-tng-marine-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-tng-marine-700" />;
}

function LinkButton({ editor }: { editor: Editor }) {
  const isActive = editor.isActive("link");

  function setLink() {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL do link (vazio para remover)", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }

  return (
    <button
      type="button"
      title={isActive ? "Editar link" : "Adicionar link"}
      onMouseDown={(e) => e.preventDefault()}
      onClick={setLink}
      className={`rounded px-1.5 py-0.5 text-[11px] transition ${
        isActive
          ? "bg-tng-orange-400/20 text-tng-orange-300"
          : "text-tng-marine-200 hover:bg-tng-marine-700"
      }`}
    >
      🔗
    </button>
  );
}
