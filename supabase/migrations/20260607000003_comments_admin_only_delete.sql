-- =============================================================================
-- Apenas admins podem apagar comentários
-- =============================================================================
-- Antes: o próprio autor OU admin podiam apagar.
-- Agora: só admin. Comentários viram registro permanente de discussão; se
-- o autor escreveu algo errado, o caminho é responder (não apagar).
-- =============================================================================

drop policy if exists "comments_delete_own_or_admin" on public.comments;

create policy "comments_delete_admin_only"
  on public.comments for delete
  to authenticated
  using (public.is_admin());
