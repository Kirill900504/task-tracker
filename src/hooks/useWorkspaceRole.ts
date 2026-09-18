"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Кто именно смотрит на трекер: владелец или руководитель.
//
// There is no `role` on the account. A workspace IS its owner (migration
// 0019), so the question "who am I here" is answered by whether a membership
// row points at me: if one does, I am somebody's manager and see only what
// I am on; if none does, this workspace is mine.
//
// Deliberately fails to "owner": that is the state the tracker has always
// been in, so a failed lookup leaves the one real user exactly where he was
// rather than locking him out of his own product.

export type WorkspaceRole = "owner" | "manager";

export type WorkspaceIdentity = {
  role: WorkspaceRole;
  // The assignees row this login is, inside the owner's workspace — the
  // bridge between "who is signed in" and "whose name is on the task".
  assigneeId: string;
  name: string;
  ownerId: string;
  // Свой auth-id. По нему интерфейс отличает «мою задачу» от «чужой,
  // которую мне видно»: править можно только то, что поставил сам.
  userId: string;
  // Администратор — только владелец. За этим флагом прячется всё, что
  // Кирилл назвал структурными изменениями: разделы, «Команда», экспорт,
  // принудительное закрытие. Прятать этого мало — те же границы стоят
  // политиками в базе (миграция 0031), потому что запрет, который обходится
  // через консоль браузера, не запрет. Кнопка убрана ради честности
  // интерфейса: предлагать то, в чём откажут, хуже, чем не предлагать.
  isAdmin: boolean;
  loading: boolean;
};

export function useWorkspaceRole(): WorkspaceIdentity {
  const [state, setState] = useState<Omit<WorkspaceIdentity, "loading">>({
    role: "owner",
    assigneeId: "",
    name: "",
    ownerId: "",
    userId: "",
    isAdmin: true,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const db = createClient();
    db.auth
      .getUser()
      .then(async ({ data }) => {
        const userId = data?.user?.id;
        if (!userId) return null;
        const { data: row } = await db
          .from("workspace_members")
          .select("owner_id, assignee_id, status, assignees(name)")
          .eq("member_id", userId)
          .eq("status", "active")
          .maybeSingle();
        const member = row as {
          owner_id: string;
          assignee_id: string;
          assignees: { name: string } | { name: string }[] | null;
        } | null;
        return { userId, member };
      })
      .then((found) => {
        if (cancelled) return;
        if (found) {
          const { userId, member } = found;
          if (member) {
            const a = member.assignees;
            setState({
              role: "manager",
              assigneeId: member.assignee_id,
              name: (Array.isArray(a) ? a[0]?.name : a?.name) || "",
              ownerId: member.owner_id,
              userId,
              isAdmin: false,
            });
          } else {
            // Строки членства нет — это его собственное пространство.
            setState((s) => ({ ...s, userId, ownerId: userId, isAdmin: true }));
          }
        }
        setLoading(false);
      })
      .catch(() => {
        // The table may not exist yet on an install whose database is
        // behind the deployment. "Owner" is the honest answer there.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state, loading };
}
