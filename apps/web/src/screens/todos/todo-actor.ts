import type { Todo } from "@tomotabi/contracts";

type Participant = { userId: string; displayName: string };

function nameOf(
  uid: string,
  meUserId: string | null,
  participants: readonly Participant[] | undefined,
): string {
  if (uid === meUserId) {
    return "あなた";
  }
  return participants?.find((p) => p.userId === uid)?.displayName ?? "相手";
}

/**
 * 行の下の一行。未完了は「〇〇が追加した」、完了は「〇〇が完了にした」
 * （予定にしたものは「〇〇が予定にした」）。自分は「あなた」と出す。
 */
export function todoActorLine(
  todo: Todo,
  meUserId: string | null,
  participants: readonly Participant[] | undefined,
): string {
  if (todo.doneAt !== null && todo.doneBy !== null) {
    const who = nameOf(todo.doneBy, meUserId, participants);
    return todo.plan !== null ? `${who}が予定にした` : `${who}が完了にした`;
  }
  return `${nameOf(todo.createdBy, meUserId, participants)}が追加した`;
}
