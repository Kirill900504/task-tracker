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
  loading: boolean;
};

export function useWorkspaceRole(): WorkspaceIdentity {
  const [state, setState] = useState<Omit<WorkspaceIdentity, "loading">>({
    role: "owner",
    assigneeId: "",
    name: "",
    ownerId: "",
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
        return row as {
          owner_id: string;
          assignee_id: string;
          assignees: { name: string } | { name: string }[] | null;
        } | null;
      })
      .then((row) => {
        if (cancelled) return;
        if (row) {
          const a = row.assignees;
          setState({
            role: "manager",
            assigneeId: row.assignee_id,
            name: (Array.isArray(a) ? a[0]?.name : a?.name) || "",
            ownerId: row.owner_id,
          });
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
