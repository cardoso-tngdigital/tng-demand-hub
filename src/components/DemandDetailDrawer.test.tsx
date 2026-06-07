import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// O drawer usa Tiptap; é caro renderizar e roubaria o foco do teste de
// integração. Substituímos por um <textarea> que respeita o contrato
// (value / onChange(html) / onBlur). Isso preserva o fluxo de salvar
// no blur sem depender da implementação real do editor.
vi.mock("./RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    onBlur,
    placeholder,
  }: {
    value: string;
    onChange: (html: string) => void;
    onBlur?: () => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="rich-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
    />
  ),
}));

// CommentsThread chama o Supabase e mantém realtime; isolamos com um stub
// trivial pra que o foco do teste seja o drawer em si.
vi.mock("./CommentsThread", () => ({
  CommentsThread: () => <div data-testid="comments-thread" />,
}));

// Mock parcial: preserva tipos; substitui só updateDemand pra interceptar
// os patches sem chegar ao Supabase real.
vi.mock("../lib/demands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/demands")>();
  return {
    ...actual,
    updateDemand: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
});

vi.mock("../lib/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/attachments")>();
  return {
    ...actual,
    listAttachments: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
});

import { DemandDetailDrawer } from "./DemandDetailDrawer";
import { updateDemand } from "../lib/demands";
import { makeClient, makeDemand, makeProfile } from "../test/factories";

const clients = [makeClient({ id: "c1", name: "Acme" })];
const profiles = [makeProfile({ id: "u1", full_name: "Cardoso" })];

describe("DemandDetailDrawer", () => {
  it("aria-hidden=true quando não há demanda selecionada", () => {
    const { container } = render(
      <DemandDetailDrawer
        demand={null}
        clients={clients}
        profiles={profiles}
        isAdmin={false}
        onClose={() => {}}
      />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("mostra título da demanda no header", () => {
    render(
      <DemandDetailDrawer
        demand={makeDemand({ title: "Refatorar checkout" })}
        clients={clients}
        profiles={profiles}
        isAdmin={false}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: /Refatorar checkout/i })).toBeInTheDocument();
  });

  it("Esc chama onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <DemandDetailDrawer
        demand={makeDemand()}
        clients={clients}
        profiles={profiles}
        isAdmin={false}
        onClose={onClose}
      />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("mudar status no select dispara updateDemand", async () => {
    const user = userEvent.setup();
    render(
      <DemandDetailDrawer
        demand={makeDemand({ id: "d1", status: "todo" })}
        clients={clients}
        profiles={profiles}
        isAdmin={false}
        onClose={() => {}}
      />,
    );
    // O select de status é o primeiro <select> do header
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[0], "doing");
    await waitFor(() => {
      expect(vi.mocked(updateDemand)).toHaveBeenCalledWith("d1", { status: "doing" });
    });
  });

  it("editar descrição e blur salva o HTML", async () => {
    const user = userEvent.setup();
    render(
      <DemandDetailDrawer
        demand={makeDemand({ id: "d1", description: "<p>antes</p>" })}
        clients={clients}
        profiles={profiles}
        isAdmin={false}
        onClose={() => {}}
      />,
    );
    const editor = screen.getByTestId("rich-editor");
    await user.clear(editor);
    await user.type(editor, "<p>depois</p>");
    editor.blur();
    await waitFor(() => {
      const calls = vi.mocked(updateDemand).mock.calls;
      const last = calls[calls.length - 1];
      expect(last[0]).toBe("d1");
      expect(last[1]).toEqual({ description: expect.stringContaining("depois") });
    });
  });
});
