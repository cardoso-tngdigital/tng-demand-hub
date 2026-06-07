import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchPalette } from "./SearchPalette";
import { makeDemand } from "../test/factories";

const demands = [
  makeDemand({ id: "d1", title: "Refatorar login", tags: ["auth"] }),
  makeDemand({ id: "d2", title: "Banner do site", tags: ["marketing", "design"] }),
  makeDemand({ id: "d3", title: "Fix do checkout", description: "<p>cliente <strong>Acme</strong></p>" }),
];

describe("SearchPalette", () => {
  it("não renderiza nada quando fechada", () => {
    const { container } = render(
      <SearchPalette open={false} demands={demands} onClose={() => {}} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("aberta sem query mostra todas demandas (score neutro)", () => {
    render(
      <SearchPalette open={true} demands={demands} onClose={() => {}} onSelect={() => {}} />,
    );
    expect(screen.getByText(/Refatorar login/i)).toBeInTheDocument();
    expect(screen.getByText(/Banner do site/i)).toBeInTheDocument();
    expect(screen.getByText(/3 resultados/i)).toBeInTheDocument();
  });

  it("placeholder de instrução aparece com query sem matches", async () => {
    const user = userEvent.setup();
    render(
      <SearchPalette open={true} demands={demands} onClose={() => {}} onSelect={() => {}} />,
    );
    await user.type(screen.getByPlaceholderText(/Buscar demanda/i), "xpto12345");
    expect(screen.getByText(/Nada encontrado/i)).toBeInTheDocument();
  });

  it("filtra demanda por título", async () => {
    const user = userEvent.setup();
    render(
      <SearchPalette open={true} demands={demands} onClose={() => {}} onSelect={() => {}} />,
    );
    const input = screen.getByPlaceholderText(/Buscar demanda/i);
    await user.type(input, "banner");
    expect(screen.getByText(/Banner do site/i)).toBeInTheDocument();
    expect(screen.queryByText(/Refatorar login/i)).not.toBeInTheDocument();
  });

  it("filtra pelo conteúdo da descrição HTML (busca usa texto puro)", async () => {
    const user = userEvent.setup();
    render(
      <SearchPalette open={true} demands={demands} onClose={() => {}} onSelect={() => {}} />,
    );
    await user.type(screen.getByPlaceholderText(/Buscar demanda/i), "Acme");
    expect(screen.getByText(/Fix do checkout/i)).toBeInTheDocument();
  });

  it("Enter chama onSelect com a demanda ativa e fecha", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchPalette open={true} demands={demands} onClose={onClose} onSelect={onSelect} />,
    );
    await user.type(screen.getByPlaceholderText(/Buscar demanda/i), "banner");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("d2");
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc chama onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchPalette open={true} demands={demands} onClose={onClose} onSelect={() => {}} />,
    );
    // O componente foca o input via setTimeout(30); foco explícito evita a
    // dependência de timer e mantém o teste determinístico.
    screen.getByPlaceholderText(/Buscar demanda/i).focus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
