import { useCallback, useEffect, useState } from "react";
import { listAllProfiles, updateProfile } from "../lib/profiles";
import type { Profile, UserRole } from "../types/database";

export function MembersAdmin({
  open,
  currentUserId,
  onClose,
}: {
  open: boolean;
  currentUserId: string | null;
  onClose: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await listAllProfiles();
    if (error) setError(error);
    else setProfiles(data);
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

  async function patchProfile(id: string, patch: Parameters<typeof updateProfile>[1]) {
    setBusyId(id);
    setError(null);
    const { data, error } = await updateProfile(id, patch);
    setBusyId(null);
    if (error) {
      setError(error);
      return;
    }
    if (data) setProfiles((prev) => prev.map((p) => (p.id === id ? data : p)));
  }

  if (!open) return null;

  const activeCount = profiles.filter((p) => p.active).length;
  const adminCount = profiles.filter((p) => p.role === "admin" && p.active).length;
  const me = profiles.find((p) => p.id === currentUserId);
  const amIAdmin = me?.role === "admin";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-tng-marine-900/95 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-tng-marine-700 px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-sans text-base font-semibold text-tng-marine-50">Membros</h2>
          <span className="text-[11px] text-tng-marine-400">
            {profiles.length} cadastrados · {activeCount} ativos · {adminCount} admin
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-md p-1.5 text-tng-marine-300 hover:bg-tng-marine-700 hover:text-tng-marine-100"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <p className="mb-4 max-w-3xl text-[11px] text-tng-marine-400">
          Novos membros são criados pelo administrador do Supabase em{" "}
          <em>Authentication → Users → Invite user</em>. Quando a pessoa aceitar
          o e-mail e definir senha, ela aparece aqui — então marque como ativa
          e defina o papel.
        </p>

        {!loading && !amIAdmin && (
          <div className="mb-3 rounded-md border border-tng-orange-400/30 bg-tng-orange-400/10 px-3 py-2 text-[11px] text-tng-orange-200">
            Você só pode visualizar esta lista. Apenas administradores alteram
            papel ou status de membros.
          </div>
        )}

        {error && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-tng-marine-300">Carregando…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-tng-marine-300">Nenhum membro cadastrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((p) => (
              <MemberRow
                key={p.id}
                profile={p}
                isSelf={p.id === currentUserId}
                canEdit={amIAdmin && p.id !== currentUserId}
                // Edição do nome tem regra mais ampla: o próprio user
                // sempre pode alterar o próprio (RLS profiles_update_own),
                // e o admin pode alterar de qualquer um.
                canEditName={amIAdmin || p.id === currentUserId}
                busy={busyId === p.id}
                onToggleActive={() => void patchProfile(p.id, { active: !p.active })}
                onChangeRole={(role) => void patchProfile(p.id, { role })}
                onRename={(full_name) => void patchProfile(p.id, { full_name })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MemberRow({
  profile,
  isSelf,
  canEdit,
  canEditName,
  busy,
  onToggleActive,
  onChangeRole,
  onRename,
}: {
  profile: Profile;
  isSelf: boolean;
  canEdit: boolean;
  canEditName: boolean;
  busy: boolean;
  onToggleActive: () => void;
  onChangeRole: (role: UserRole) => void;
  onRename: (fullName: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(profile.full_name);

  // Quando o realtime / refresh traz nome novo (e não estamos editando),
  // sincroniza o draft pro próximo "editar".
  useEffect(() => {
    if (!editingName) setDraftName(profile.full_name);
  }, [profile.full_name, editingName]);

  function commitName() {
    const next = draftName.trim();
    setEditingName(false);
    if (!next || next === profile.full_name) {
      setDraftName(profile.full_name);
      return;
    }
    onRename(next);
  }
  function cancelEdit() {
    setDraftName(profile.full_name);
    setEditingName(false);
  }
  const inactive = !profile.active;
  const disabled = busy || !canEdit;
  const disabledTitle = isSelf
    ? "Você não pode alterar seu próprio papel ou status"
    : !canEdit
    ? "Apenas administradores podem alterar membros"
    : undefined;
  return (
    <li
      className={`rounded-lg border border-tng-marine-700 bg-tng-marine-800/40 px-4 py-3 transition ${
        inactive ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editingName ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEdit();
                  }
                }}
                disabled={busy}
                className="min-w-0 max-w-xs flex-1 rounded-md border border-tng-orange-400/60 bg-tng-marine-800 px-2 py-0.5 text-sm font-medium text-tng-marine-50 focus:outline-none"
              />
            ) : (
              <>
                <h3 className="truncate text-sm font-medium text-tng-marine-50">
                  {profile.full_name || "(sem nome)"}
                </h3>
                {canEditName && (
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    disabled={busy}
                    aria-label="Editar nome"
                    title="Editar nome"
                    className="text-[10px] text-tng-marine-400 hover:text-tng-orange-400 disabled:opacity-40"
                  >
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                  </button>
                )}
              </>
            )}
            {isSelf && (
              <span className="rounded-full bg-tng-orange-400/15 px-2 py-0.5 text-[9px] uppercase tracking-wider text-tng-orange-300">
                você
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${
                profile.role === "admin"
                  ? "bg-tng-orange-400/15 text-tng-orange-300"
                  : "bg-tng-marine-700 text-tng-marine-300"
              }`}
            >
              {profile.role}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${
                inactive
                  ? "bg-tng-marine-700 text-tng-marine-300"
                  : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {inactive ? "inativo" : "ativo"}
            </span>
          </div>
          {profile.area && (
            <p className="mt-1 text-[11px] text-tng-marine-300">{profile.area}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={profile.role}
            disabled={disabled}
            onChange={(e) => onChangeRole(e.target.value as UserRole)}
            title={disabledTitle}
            className="rounded-md border border-tng-marine-600 bg-tng-marine-800 px-2 py-1 text-[10px] text-tng-marine-100 focus:border-tng-orange-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="member" className="bg-tng-marine-800">member</option>
            <option value="admin" className="bg-tng-marine-800">admin</option>
          </select>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={disabled}
            title={disabledTitle}
            className="rounded-md border border-tng-marine-600 px-2 py-1 text-[10px] text-tng-marine-200 transition hover:border-tng-orange-400 hover:text-tng-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inactive ? "reativar" : "desativar"}
          </button>
        </div>
      </div>
    </li>
  );
}
