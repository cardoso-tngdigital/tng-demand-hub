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
// =============================================================================

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

export type RichTextVariant = "full" | "compact";

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  variant = "full",
  autoFocus = false,
  minHeight,
}: {
  value: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  variant?: RichTextVariant;
  autoFocus?: boolean;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
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
    ],
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
    </div>
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
