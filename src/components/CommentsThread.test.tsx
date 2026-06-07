import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (html: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="comment-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock("../lib/comments", () => ({
  listComments: vi.fn(),
  createComment: vi.fn(),
  deleteComment: vi.fn(),
  subscribeToComments: vi.fn(() => () => {}),
}));

import { CommentsThread } from "./CommentsThread";
import { createComment, deleteComment, listComments } from "../lib/comments";
import { makeComment, makeProfile } from "../test/factories";

const profiles = [
  makeProfile({ id: "u1", full_name: "Cardoso" }),
  makeProfile({ id: "u2", full_name: "Outro" }),
];

describe("CommentsThread", () => {
  it("mostra placeholder quando não há comentários", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({ data: [], error: null });
    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={false} />);
    await waitFor(() =>
      expect(screen.getByText(/Nenhum comentário ainda/i)).toBeInTheDocument(),
    );
  });

  it("renderiza HTML sanitizado de cada comentário", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      data: [
        makeComment({ id: "c1", author_id: "u1", content: "<p>oi <strong>tudo</strong></p>" }),
        makeComment({ id: "c2", author_id: "u2", content: "texto puro" }),
      ],
      error: null,
    });

    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={false} />);

    await waitFor(() => {
      expect(screen.getByText("tudo")).toBeInTheDocument();
    });
    expect(screen.getByText("tudo").tagName).toBe("STRONG");
    expect(screen.getByText("texto puro")).toBeInTheDocument();
    expect(screen.getByText("Cardoso")).toBeInTheDocument();
    expect(screen.getByText("Outro")).toBeInTheDocument();
  });

  it("non-admin não vê botão remover nem nos próprios comentários", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      data: [
        makeComment({ id: "c1", author_id: "u1", content: "<p>meu</p>" }),
        makeComment({ id: "c2", author_id: "u2", content: "<p>outro</p>" }),
      ],
      error: null,
    });

    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={false} />);

    await waitFor(() => {
      expect(screen.getByText("meu")).toBeInTheDocument();
    });
    expect(screen.queryAllByRole("button", { name: /Remover comentário/i })).toHaveLength(0);
  });

  it("admin vê botão remover em TODOS os comentários", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      data: [
        makeComment({ id: "c1", author_id: "u1", content: "<p>meu</p>" }),
        makeComment({ id: "c2", author_id: "u2", content: "<p>outro</p>" }),
      ],
      error: null,
    });

    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={true} />);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Remover comentário/i })).toHaveLength(2);
    });
  });

  it("submit chama createComment com HTML sanitizado", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({ data: [], error: null });
    vi.mocked(createComment).mockResolvedValueOnce({
      data: makeComment({ id: "novo", content: "<p>novo</p>" }),
      error: null,
    });
    const user = userEvent.setup();
    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={false} />);
    await waitFor(() => expect(screen.getByText(/Nenhum comentário/i)).toBeInTheDocument());

    const editor = screen.getByTestId("comment-editor");
    await user.type(editor, "<p>novo</p>");
    await user.click(screen.getByRole("button", { name: /Comentar/i }));

    await waitFor(() => {
      expect(vi.mocked(createComment)).toHaveBeenCalledWith(
        "d1",
        expect.stringContaining("novo"),
      );
    });
  });

  it("botão Comentar fica desabilitado quando texto está vazio", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({ data: [], error: null });
    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={false} />);
    await waitFor(() => expect(screen.getByText(/Nenhum comentário/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Comentar/i })).toBeDisabled();
  });

  it("admin clica remover e chama deleteComment com o id certo", async () => {
    vi.mocked(listComments).mockResolvedValueOnce({
      data: [makeComment({ id: "c1", author_id: "u1", content: "<p>x</p>" })],
      error: null,
    });
    vi.mocked(deleteComment).mockResolvedValueOnce({ error: null });

    const user = userEvent.setup();
    render(<CommentsThread demandId="d1" profiles={profiles} isAdmin={true} />);
    const btn = await screen.findByRole("button", { name: /Remover comentário/i });
    await user.click(btn);
    expect(vi.mocked(deleteComment)).toHaveBeenCalledWith("c1");
  });
});
