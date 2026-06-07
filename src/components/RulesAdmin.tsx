import { useCallback, useEffect, useState } from "react";
import {
  createRule,
  deleteRule,
  listRules,
  updateRule,
  type RuleInput,
} from "../lib/classificationRules";
import type { ClientOption, ProfileOption } from "../lib/lookups";
import type {
  ClassificationRule,
  RuleMatchField,
  RuleMatchOperator,
  RuleSetField,
} from "../types/database";

const PRIORITIES = ["baixa", "media", "alta", "urgente"] as const;

export function RulesAdmin({
  open,
  isAdmin,
  clients,
  profiles,
  onClose,
}: {
  open: boolean;
  isAdmin: boolean;
  clients: ClientOption[];
  profiles: ProfileOption[];
  onClose: () => void;
}) {
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listRules();
    if (error) setError(error);
    else setRules(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleCreate(input: RuleInput) {
    setError(null);
    const { data, error } = await createRule(input);
    if (error) {
      setError(error);
      return false;
    }
    if (data) setRules((prev) => [data, ...prev]);
    setCreating(false);
    return true;
  }

  async function handleUpdate(id: string, input: RuleInput) {
    setError(null);
    const { data, error } = await updateRule(id, input);
    if (error) {
      setError(error);
      return false;
    }
    if (data) setRules((prev) => prev.map((r) => (r.id === id ? data : r)));
    setEditingId(null);
    return true;
  }

  async function handleToggle(rule: ClassificationRule) {
    setError(null);
    const { data, error } = await updateRule(rule.id, { active: !rule.active });
    if (error) {
      setError(error);
      return;
    }
    if (data) setRules((prev) => prev.map((r) => (r.id === rule.id ? data : r)));
  }

  async function handleDelete(rule: ClassificationRule) {
    if (!window.confirm(`Excluir a regra "${rule.name}"?`)) return;
    setError(null);
    const { error } = await deleteRule(rule.id);
    if (error) {
      setError(error);
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
  }

  if (!open) return null;

  const activeCount = rules.filter((r) => r.active).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-tng-marine-900/95 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-sans text-base font-semibold text-tng-marine-50">
            Regras de auto-classificação
          </h2>
          <span className="text-[11px] text-tng-marine-400">
            {rules.length} cadastradas · {activeCount} ativas
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300"
            >
              {creating ? "Cancelar" : "Nova regra"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
          >
            <i className="fa-solid fa-xmark" aria-hidden="true" />          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <p className="mb-4 max-w-3xl text-[11px] text-tng-marine-400">
          Regras rodam <em>depois</em> da extração da IA e <em>antes</em> da
          tela de revisão. Ex.: "quando descrição contém 'urgente', definir
          prioridade alta" ou "quando cliente é Acme, atribuir Pedro".
        </p>

        {!isAdmin && !loading && (
          <div className="mb-3 rounded-md border border-tng-orange-400/30 bg-tng-orange-400/10 px-3 py-2 text-[11px] text-tng-orange-200">
            Você só pode visualizar as regras. Apenas administradores criam ou
            editam.
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {creating && isAdmin && (
          <div className="mb-4">
            <RuleForm
              clients={clients}
              profiles={profiles}
              onSubmit={handleCreate}
              onCancel={() => setCreating(false)}
              submitLabel="Criar regra"
            />
          </div>
        )}

        {loading ? (
          <p className="text-sm text-tng-marine-300">Carregando…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-tng-marine-300">Nenhuma regra cadastrada ainda.</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) =>
              editingId === r.id && isAdmin ? (
                <li
                  key={r.id}
                  className="rounded-lg border border-tng-orange-400/40 bg-tng-marine-800/40 p-3"
                >
                  <RuleForm
                    initial={r}
                    clients={clients}
                    profiles={profiles}
                    onSubmit={(input) => handleUpdate(r.id, input)}
                    onCancel={() => setEditingId(null)}
                    submitLabel="Salvar alterações"
                  />
                </li>
              ) : (
                <RuleRow
                  key={r.id}
                  rule={r}
                  clients={clients}
                  profiles={profiles}
                  canEdit={isAdmin}
                  onEdit={() => setEditingId(r.id)}
                  onToggle={() => void handleToggle(r)}
                  onDelete={() => void handleDelete(r)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function describeRule(
  r: ClassificationRule,
  clients: ClientOption[],
  profiles: ProfileOption[],
): string {
  const opLabel = r.match_operator === "contains" ? "contém" : "é igual a";
  const fieldLabel =
    r.match_field === "description"
      ? "descrição"
      : r.match_field === "client"
      ? "cliente"
      : "tag";
  const setLabel =
    r.set_field === "assignee_id"
      ? "responsável"
      : r.set_field === "priority"
      ? "prioridade"
      : "tag";
  let setHuman = r.set_value;
  if (r.set_field === "assignee_id") {
    setHuman = profiles.find((p) => p.id === r.set_value)?.full_name ?? r.set_value;
  } else if (r.match_field === "client" && /^[0-9a-f-]{36}$/.test(r.match_value)) {
    const c = clients.find((x) => x.id === r.match_value);
    if (c) setHuman = c.alias || c.name;
  }
  return `Quando ${fieldLabel} ${opLabel} "${r.match_value}", definir ${setLabel} como "${setHuman}".`;
}

function RuleRow({
  rule,
  clients,
  profiles,
  canEdit,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: ClassificationRule;
  clients: ClientOption[];
  profiles: ProfileOption[];
  canEdit: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const inactive = !rule.active;
  return (
    <li
      className={`rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3 transition ${
        inactive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-tng-marine-50">{rule.name}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${
                inactive
                  ? "bg-tng-marine-700 text-tng-marine-300"
                  : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {inactive ? "inativa" : "ativa"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-tng-marine-300">
            {describeRule(rule, clients, profiles)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
              >
                editar
              </button>
              <button
                type="button"
                onClick={onToggle}
                className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-200 hover:border-tng-orange-400 hover:text-tng-orange-400"
              >
                {inactive ? "ativar" : "desativar"}
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-300 hover:border-red-400 hover:text-red-300"
              >
                excluir
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function RuleForm({
  initial,
  clients,
  profiles,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: ClassificationRule;
  clients: ClientOption[];
  profiles: ProfileOption[];
  onSubmit: (input: RuleInput) => Promise<boolean>;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [matchField, setMatchField] = useState<RuleMatchField>(initial?.match_field ?? "description");
  const [matchOperator, setMatchOperator] = useState<RuleMatchOperator>(initial?.match_operator ?? "contains");
  const [matchValue, setMatchValue] = useState(initial?.match_value ?? "");
  const [setField, setSetField] = useState<RuleSetField>(initial?.set_field ?? "priority");
  const [setValue, setSetValue] = useState(initial?.set_value ?? "alta");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      match_field: matchField,
      match_operator: matchOperator,
      match_value: matchValue.trim(),
      set_field: setField,
      set_value: setValue.trim(),
    });
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 p-4"
    >
      <Field label="Nome da regra *">
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: Banner sempre prioridade alta"
          className={inputClass}
        />
      </Field>

      <div className="rounded-md border border-tng-marine-700 bg-tng-marine-800/60 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-tng-marine-300">Quando</p>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={matchField}
            onChange={(e) => setMatchField(e.target.value as RuleMatchField)}
            className={inputClass}
          >
            <option value="description" className="bg-tng-marine-800">descrição</option>
            <option value="client" className="bg-tng-marine-800">cliente</option>
            <option value="tag" className="bg-tng-marine-800">tag</option>
          </select>
          <select
            value={matchOperator}
            onChange={(e) => setMatchOperator(e.target.value as RuleMatchOperator)}
            className={inputClass}
          >
            <option value="contains" className="bg-tng-marine-800">contém</option>
            <option value="equals" className="bg-tng-marine-800">é igual a</option>
          </select>
          {matchField === "client" ? (
            <select
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              className={inputClass}
            >
              <option value="" className="bg-tng-marine-800">— selecione</option>
              {clients.map((c) => (
                <option key={c.id} value={c.alias || c.name} className="bg-tng-marine-800">
                  {c.alias || c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              required
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              placeholder="texto"
              className={inputClass}
            />
          )}
        </div>
      </div>

      <div className="rounded-md border border-tng-marine-700 bg-tng-marine-800/60 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-tng-marine-300">Então</p>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={setField}
            onChange={(e) => {
              const v = e.target.value as RuleSetField;
              setSetField(v);
              if (v === "priority") setSetValue("alta");
              else if (v === "assignee_id") setSetValue(profiles[0]?.id ?? "");
              else setSetValue("");
            }}
            className={inputClass}
          >
            <option value="priority" className="bg-tng-marine-800">prioridade</option>
            <option value="assignee_id" className="bg-tng-marine-800">responsável</option>
            <option value="tag" className="bg-tng-marine-800">adicionar tag</option>
          </select>
          {setField === "priority" ? (
            <select
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
              className={inputClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p} className="bg-tng-marine-800">{p}</option>
              ))}
            </select>
          ) : setField === "assignee_id" ? (
            <select
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
              className={inputClass}
            >
              <option value="" className="bg-tng-marine-800">— selecione</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id} className="bg-tng-marine-800">
                  {p.full_name}
                </option>
              ))}
            </select>
          ) : (
            <input
              required
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
              placeholder="ex.: design"
              className={inputClass}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs text-tng-marine-300 hover:text-tng-marine-100"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0 || matchValue.trim().length === 0 || setValue.trim().length === 0}
          className="rounded-md bg-tng-orange-400 px-3 py-1.5 text-xs font-semibold text-tng-marine-900 transition hover:bg-tng-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Salvando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wider text-tng-marine-300">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "block w-full rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2.5 py-1.5 text-sm text-tng-marine-100 placeholder:text-tng-marine-400 focus:border-tng-orange-400 focus:outline-none";
