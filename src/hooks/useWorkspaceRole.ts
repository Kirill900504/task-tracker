"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSelfAssignee } from "@/lib/trackerRows";

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

// Чем человек занимается в пространстве, в отличие от того, чьё оно.
// «Руководитель» работает, «администратор» и «разработчик» вдобавок меняют
// структуру — разделы и ответственных за них (миграция 0036). Разводить
// последних двух правами пока незачем: разными их делает подпись в
// «Команде», а не набор кнопок.
export type MemberRole = "owner" | "manager" | "admin" | "developer";

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Владелец",
  manager: "Руководитель",
  admin: "Администратор",
  developer: "Разработчик",
};

export type WorkspaceIdentity = {
  role: WorkspaceRole;
  // Роль внутри пространства — она же надпись в «Команде». У владельца
  // строки членства нет вовсе, и это «owner».
  memberRole: MemberRole;
  // The assignees row this login is, inside the owner's workspace — the
  // bridge between "who is signed in" and "whose name is on the task".
  //
  // У владельца членства нет, и до сих пор здесь было пусто. Но задачи
  // ставят и ему — с тех пор как руководители работают в паритете, это
  // обычное дело, — а значит и ему нужно знать, какая строка в списке
  // людей его собственная: без неё в карточке не появятся «Принял» и
  // «Сделал». Его строка помечена «(я)»; она для того в списке и стоит.
  // Ответ один на весь трекер и считается здесь, а не в каждой панели
  // по-своему — по той же причине, по которой один ответ у isMine.
  assigneeId: string;
  name: string;
  ownerId: string;
  // Свой auth-id. По нему интерфейс отличает «мою задачу» от «чужой,
  // которую мне видно»: править можно только то, что поставил сам.
  userId: string;
  // Можно ли менять структуру пространства: разделы, ответственных за них,
  // принудительное закрытие. Владелец — всегда, остальные — если он дал им
  // роль (миграция 0036). Прятать этого мало: те же границы стоят
  // политиками в базе, потому что запрет, который обходится через консоль
  // браузера, не запрет. Кнопка убрана ради честности интерфейса:
  // предлагать то, в чём откажут, хуже, чем не предлагать.
  isAdmin: boolean;
  // Список людей, приглашения и раздача ролей остаются за владельцем и
  // после того, как администраторы появились: «Команда» — это доступ в
  // трекер, и раздавать его может только тот, чьё это пространство.
  isOwner: boolean;
  loading: boolean;
};

export function useWorkspaceRole(): WorkspaceIdentity {
  const [state, setState] = useState<Omit<WorkspaceIdentity, "loading">>({
    role: "owner",
    memberRole: "owner",
    assigneeId: "",
    name: "",
    ownerId: "",
    userId: "",
    isAdmin: true,
    isOwner: true,
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
          .select("owner_id, assignee_id, status, role, assignees(name)")
          .eq("member_id", userId)
          .eq("status", "active")
          .maybeSingle();
        const member = row as {
          owner_id: string;
          assignee_id: string;
          role: string | null;
          assignees: { name: string } | { name: string }[] | null;
        } | null;
        if (member) return { userId, member, selfAssigneeId: "" };
        // Владелец: своя строка в списке людей — та, что помечена «(я)».
        const { data: mine } = await db.from("assignees").select("id, name").eq("user_id", userId);
        const self = (mine || []).find((r) => isSelfAssignee((r.name as string) || ""));
        return { userId, member, selfAssigneeId: (self?.id as string) || "" };
      })
      .then((found) => {
        if (cancelled) return;
        if (found) {
          const { userId, member, selfAssigneeId } = found;
          if (member) {
            const a = member.assignees;
            // Роль, которой в базе нет или которой там быть не должно,
            // читается как обычный руководитель: неизвестное слово не повод
            // выдавать права, которых оно не называет.
            const memberRole: MemberRole =
              member.role === "admin" || member.role === "developer" ? member.role : "manager";
            setState({
              role: "manager",
              memberRole,
              assigneeId: member.assignee_id,
              name: (Array.isArray(a) ? a[0]?.name : a?.name) || "",
              ownerId: member.owner_id,
              userId,
              isAdmin: memberRole !== "manager",
              isOwner: false,
            });
          } else {
            // Строки членства нет — это его собственное пространство.
            setState((s) => ({
              ...s,
              userId,
              ownerId: userId,
              assigneeId: selfAssigneeId,
              isAdmin: true,
              isOwner: true,
              memberRole: "owner",
            }));
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
